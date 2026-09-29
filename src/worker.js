/**
 * ideashop EC — Worker backend
 * ------------------------------------------------------------------
 * Sirve la carpeta /public como sitio estático (eso lo hace Cloudflare
 * automáticamente vía el binding "ASSETS", declarado en wrangler.toml)
 * y además atiende las rutas /api/* definidas aquí.
 *
 * Recursos que usa (declarados en wrangler.toml, ver ese archivo):
 *  - env.DB       -> base de datos D1 (tabla libros, pedidos, descargas)
 *  - env.LIBROS   -> bucket R2 privado donde viven los PDF
 *  - env.ADMIN_PASSWORD  -> secret, la contraseña del panel /admin
 *  - env.SESSION_SECRET  -> secret, llave para firmar la cookie de sesión
 *
 * Ninguna credencial va escrita en este archivo: ambas se configuran
 * como "secrets" desde el dashboard de Cloudflare o con:
 *   npx wrangler secret put ADMIN_PASSWORD
 *   npx wrangler secret put SESSION_SECRET
 */

const DESCARGAS_MAX_INTENTOS = 3;
const DESCARGAS_HORAS_VALIDEZ = 72;
const SESSION_HORAS = 12;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // ---- Catálogo público ----
      if (pathname === "/api/libros" && request.method === "GET") {
        return await listarLibrosPublicos(env);
      }
      if (pathname.startsWith("/api/libros/") && request.method === "GET") {
        const slug = pathname.replace("/api/libros/", "");
        return await obtenerLibroPublico(env, slug);
      }

      // ---- Checkout / pagos ----
      if (pathname === "/api/checkout" && request.method === "POST") {
        return await crearPedido(request, env);
      }
      if (pathname === "/api/pago/webhook-pasarela" && request.method === "POST") {
        return await confirmarPagoPasarela(request, env);
      }

      // ---- Descarga protegida (3 intentos o 72h) ----
      // /estado consulta sin gastar intento (para pintar la página);
      // la ruta base sí gasta un intento y entrega el archivo.
      if (pathname.match(/^\/api\/descarga\/[^/]+\/estado$/) && request.method === "GET") {
        const token = pathname.split("/")[3];
        return await estadoDescarga(token, env);
      }
      if (pathname.startsWith("/api/descarga/") && request.method === "GET") {
        const token = pathname.replace("/api/descarga/", "");
        return await procesarDescarga(token, env);
      }

      // ---- Panel de administración ----
      if (pathname === "/api/admin/login" && request.method === "POST") {
        return await adminLogin(request, env);
      }
      if (pathname.startsWith("/api/admin/")) {
        const sesionOk = await validarSesionAdmin(request, env);
        if (!sesionOk) return json({ error: "No autorizado" }, 401);
        return await manejarRutaAdmin(request, env, pathname);
      }

      // Cualquier otra ruta /api/* que no exista
      if (pathname.startsWith("/api/")) {
        return json({ error: "Ruta no encontrada" }, 404);
      }

      // Todo lo demás (páginas, css, etc.) lo sirven los assets estáticos.
      // Si este Worker se está ejecutando aquí es porque no hubo match de
      // asset estático, así que devolvemos 404 simple.
      return new Response("No encontrado", { status: 404 });
    } catch (err) {
      console.error(err);
      return json({ error: "Error interno", detalle: String(err) }, 500);
    }
  },
};

// ===================================================================
// Catálogo público
// ===================================================================

async function listarLibrosPublicos(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, titulo, descripcion, precio_centavos, edad_desde, edad_hasta,
            paginas, categoria, portada_color, etiqueta
     FROM libros WHERE activo = 1 ORDER BY creado_en DESC`
  ).all();
  return json({ libros: results.map(formatearLibro) });
}

async function obtenerLibroPublico(env, slug) {
  const libro = await env.DB.prepare(
    `SELECT slug, titulo, descripcion, precio_centavos, edad_desde, edad_hasta,
            paginas, categoria, portada_color, etiqueta
     FROM libros WHERE slug = ? AND activo = 1`
  )
    .bind(slug)
    .first();
  if (!libro) return json({ error: "Libro no encontrado" }, 404);
  return json({ libro: formatearLibro(libro) });
}

function formatearLibro(l) {
  return {
    slug: l.slug,
    titulo: l.titulo,
    descripcion: l.descripcion,
    precio: (l.precio_centavos / 100).toFixed(2),
    edad_desde: l.edad_desde,
    edad_hasta: l.edad_hasta,
    paginas: l.paginas,
    categoria: l.categoria,
    portada_color: l.portada_color,
    etiqueta: l.etiqueta,
  };
}

// ===================================================================
// Checkout y confirmación de pago
// ===================================================================

async function crearPedido(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.slug || !body.email || !body.metodo) {
    return json({ error: "Faltan datos: slug, email, metodo" }, 400);
  }
  if (!["pasarela", "transferencia"].includes(body.metodo)) {
    return json({ error: "metodo debe ser 'pasarela' o 'transferencia'" }, 400);
  }

  const libro = await env.DB.prepare(
    `SELECT id, precio_centavos FROM libros WHERE slug = ? AND activo = 1`
  )
    .bind(body.slug)
    .first();
  if (!libro) return json({ error: "Libro no encontrado" }, 404);

  const codigo = "IE-" + Math.floor(10000 + Math.random() * 89999);

  await env.DB.prepare(
    `INSERT INTO pedidos (codigo, libro_id, email_comprador, metodo_pago, monto_centavos)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(codigo, libro.id, body.email, body.metodo, libro.precio_centavos)
    .run();

  return json({ pedido: { codigo, estado: "pendiente" } });
}

// Confirmación desde la pasarela de pago (Payphone / PlacetoPay).
// IMPORTANTE: esto es un STUB funcional para la maqueta. En producción,
// antes de marcar el pedido como pagado hay que:
//   1) Verificar la firma / token que envía la pasarela (no confiar en el body tal cual).
//   2) Volver a consultar el estado de la transacción contra la API de la pasarela
//      (GetStatus / getRequestInformation) en vez de confiar solo en el webhook.
async function confirmarPagoPasarela(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.codigo) return json({ error: "Falta 'codigo'" }, 400);

  const pedido = await env.DB.prepare(`SELECT * FROM pedidos WHERE codigo = ?`)
    .bind(body.codigo)
    .first();
  if (!pedido) return json({ error: "Pedido no encontrado" }, 404);
  if (pedido.estado === "pagado") {
    return json({ ok: true, ya_estaba_pagado: true });
  }

  await env.DB.prepare(
    `UPDATE pedidos SET estado = 'pagado', confirmado_en = datetime('now'),
     referencia_pasarela = ? WHERE id = ?`
  )
    .bind(body.referencia ?? null, pedido.id)
    .run();

  const token = await generarTokenDescarga(env, pedido.id);

  // Aquí, en producción, se dispararía el correo con el link:
  //   https://ideashopec.com/descarga.html?token=TOKEN
  // usando Resend/Mailgun/Postmark (ver la guía de correo que ya definimos).

  return json({ ok: true, token });
}

async function generarTokenDescarga(env, pedidoId) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiraEn = new Date(Date.now() + DESCARGAS_HORAS_VALIDEZ * 3600 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO descargas (token, pedido_id, intentos_restantes, expira_en)
     VALUES (?, ?, ?, ?)`
  )
    .bind(token, pedidoId, DESCARGAS_MAX_INTENTOS, expiraEn)
    .run();
  return token;
}

// ===================================================================
// Descarga protegida: 3 intentos O 72 horas, lo que ocurra primero
// ===================================================================

async function estadoDescarga(token, env) {
  const fila = await env.DB.prepare(
    `SELECT d.*, p.libro_id, l.titulo FROM descargas d
     JOIN pedidos p ON p.id = d.pedido_id
     JOIN libros l ON l.id = p.libro_id
     WHERE d.token = ?`
  )
    .bind(token)
    .first();

  if (!fila) return json({ error: "Enlace inválido" }, 404);

  const expirado = new Date(fila.expira_en).getTime() < Date.now();
  const agotado = fila.intentos_restantes <= 0;

  return json({
    titulo: fila.titulo,
    intentos_restantes: fila.intentos_restantes,
    intentos_max: DESCARGAS_MAX_INTENTOS,
    expira_en: fila.expira_en,
    agotado,
    expirado,
    disponible: !agotado && !expirado,
  });
}

async function procesarDescarga(token, env) {
  const fila = await env.DB.prepare(
    `SELECT d.*, p.libro_id FROM descargas d
     JOIN pedidos p ON p.id = d.pedido_id
     WHERE d.token = ?`
  )
    .bind(token)
    .first();

  if (!fila) return json({ error: "Enlace inválido" }, 404);

  const expirado = new Date(fila.expira_en).getTime() < Date.now();
  const agotado = fila.intentos_restantes <= 0;

  if (expirado || agotado) {
    return json(
      { error: "Enlace no disponible", expirado, agotado },
      410 // Gone
    );
  }

  const libro = await env.DB.prepare(`SELECT pdf_key, titulo FROM libros WHERE id = ?`)
    .bind(fila.libro_id)
    .first();
  if (!libro || !libro.pdf_key) {
    return json({ error: "El archivo aún no está disponible, contáctanos" }, 404);
  }

  const objeto = await env.LIBROS.get(libro.pdf_key);
  if (!objeto) return json({ error: "Archivo no encontrado en el almacenamiento" }, 404);

  await env.DB.prepare(
    `UPDATE descargas SET intentos_restantes = intentos_restantes - 1 WHERE token = ?`
  )
    .bind(token)
    .run();

  return new Response(objeto.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${libro.titulo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

// ===================================================================
// Admin: login por sesión firmada (cookie)
// ===================================================================

async function adminLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.password) return json({ error: "Falta password" }, 400);

  if (body.password !== env.ADMIN_PASSWORD) {
    return json({ error: "Contraseña incorrecta" }, 401);
  }

  const expira = Date.now() + SESSION_HORAS * 3600 * 1000;
  const firma = await firmar(`${expira}`, env.SESSION_SECRET);
  const valor = `${expira}.${firma}`;

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `ideashop_admin=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HORAS * 3600}`
  );
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function validarSesionAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/ideashop_admin=([^;]+)/);
  if (!match) return false;

  const [expiraStr, firma] = decodeURIComponent(match[1]).split(".");
  if (!expiraStr || !firma) return false;
  if (Number(expiraStr) < Date.now()) return false;

  const firmaEsperada = await firmar(expiraStr, env.SESSION_SECRET);
  return firma === firmaEsperada;
}

async function firmar(mensaje, secreto) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", key, encoder.encode(mensaje));
  return btoa(String.fromCharCode(...new Uint8Array(firma)));
}

// ===================================================================
// Admin: CRUD de libros + subida de PDF + confirmar transferencias
// ===================================================================

async function manejarRutaAdmin(request, env, pathname) {
  // GET /api/admin/libros -> todos los libros (incluye inactivos)
  if (pathname === "/api/admin/libros" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM libros ORDER BY creado_en DESC`
    ).all();
    return json({ libros: results });
  }

  // POST /api/admin/libros -> crear libro nuevo
  if (pathname === "/api/admin/libros" && request.method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || !b.slug || !b.titulo || !b.precio_centavos) {
      return json({ error: "Faltan datos: slug, titulo, precio_centavos" }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO libros (slug, titulo, descripcion, precio_centavos, edad_desde, edad_hasta, paginas, categoria, portada_color, etiqueta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        b.slug,
        b.titulo,
        b.descripcion ?? null,
        b.precio_centavos,
        b.edad_desde ?? null,
        b.edad_hasta ?? null,
        b.paginas ?? null,
        b.categoria ?? null,
        b.portada_color ?? "#4FB4E8",
        b.etiqueta ?? null
      )
      .run();
    return json({ ok: true });
  }

  // PUT /api/admin/libros/:id -> editar
  const editMatch = pathname.match(/^\/api\/admin\/libros\/(\d+)$/);
  if (editMatch && request.method === "PUT") {
    const id = Number(editMatch[1]);
    const b = await request.json().catch(() => null);
    if (!b) return json({ error: "Body inválido" }, 400);
    await env.DB.prepare(
      `UPDATE libros SET titulo=?, descripcion=?, precio_centavos=?, edad_desde=?, edad_hasta=?,
       paginas=?, categoria=?, portada_color=?, etiqueta=?, activo=? WHERE id=?`
    )
      .bind(
        b.titulo,
        b.descripcion ?? null,
        b.precio_centavos,
        b.edad_desde ?? null,
        b.edad_hasta ?? null,
        b.paginas ?? null,
        b.categoria ?? null,
        b.portada_color ?? "#4FB4E8",
        b.etiqueta ?? null,
        b.activo ? 1 : 0,
        id
      )
      .run();
    return json({ ok: true });
  }

  // DELETE /api/admin/libros/:id -> baja lógica (activo = 0)
  if (editMatch && request.method === "DELETE") {
    const id = Number(editMatch[1]);
    await env.DB.prepare(`UPDATE libros SET activo = 0 WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  // POST /api/admin/libros/:id/pdf -> sube el PDF a R2 (body = el archivo crudo)
  const pdfMatch = pathname.match(/^\/api\/admin\/libros\/(\d+)\/pdf$/);
  if (pdfMatch && request.method === "POST") {
    const id = Number(pdfMatch[1]);
    const libro = await env.DB.prepare(`SELECT slug FROM libros WHERE id = ?`).bind(id).first();
    if (!libro) return json({ error: "Libro no encontrado" }, 404);

    const key = `libros/${libro.slug}.pdf`;
    await env.LIBROS.put(key, request.body, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await env.DB.prepare(`UPDATE libros SET pdf_key = ? WHERE id = ?`).bind(key, id).run();
    return json({ ok: true, pdf_key: key });
  }

  // GET /api/admin/pedidos -> lista de pedidos (para revisar transferencias pendientes)
  if (pathname === "/api/admin/pedidos" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.*, l.titulo FROM pedidos p JOIN libros l ON l.id = p.libro_id
       ORDER BY p.creado_en DESC LIMIT 100`
    ).all();
    return json({ pedidos: results });
  }

  // POST /api/admin/pedidos/:codigo/confirmar-transferencia
  const confMatch = pathname.match(/^\/api\/admin\/pedidos\/([^/]+)\/confirmar-transferencia$/);
  if (confMatch && request.method === "POST") {
    const codigo = confMatch[1];
    const pedido = await env.DB.prepare(`SELECT * FROM pedidos WHERE codigo = ?`).bind(codigo).first();
    if (!pedido) return json({ error: "Pedido no encontrado" }, 404);
    if (pedido.estado === "pagado") return json({ ok: true, ya_estaba_pagado: true });

    await env.DB.prepare(
      `UPDATE pedidos SET estado = 'pagado', confirmado_en = datetime('now') WHERE id = ?`
    )
      .bind(pedido.id)
      .run();
    const token = await generarTokenDescarga(env, pedido.id);
    return json({ ok: true, token });
  }

  return json({ error: "Ruta admin no encontrada" }, 404);
}

// ===================================================================
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
