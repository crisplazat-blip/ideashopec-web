// Panel de administración — ideashop EC
// Habla con las rutas /api/admin/* del Worker (src/worker.js).
// La sesión se maneja con una cookie httpOnly que pone el propio backend;
// aquí no se guarda la contraseña en ningún lado del navegador.

async function login() {
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("loginError");
  errorEl.style.display = "none";

  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    errorEl.textContent = "Contraseña incorrecta.";
    errorEl.style.display = "block";
    return;
  }

  mostrarApp();
}

function logout() {
  document.cookie = "ideashop_admin=; Max-Age=0; Path=/";
  document.getElementById("app").hidden = true;
  document.getElementById("login").hidden = false;
  document.getElementById("btnLogout").hidden = true;
}

async function mostrarApp() {
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("btnLogout").hidden = false;
  await Promise.all([cargarLibros(), cargarPedidos()]);
}

// Al abrir la página, intenta cargar el catálogo admin directamente;
// si la cookie de sesión ya es válida, entra sin pedir contraseña de nuevo.
(async function intentarSesionExistente() {
  const res = await fetch("/api/admin/libros");
  if (res.ok) mostrarApp();
})();

async function crearLibro() {
  const msg = document.getElementById("crearMsg");
  const body = {
    slug: val("f_slug"),
    titulo: val("f_titulo"),
    descripcion: val("f_descripcion"),
    precio_centavos: Math.round(parseFloat(val("f_precio") || "0") * 100),
    categoria: val("f_categoria"),
    edad_desde: intOrNull("f_edad_desde"),
    edad_hasta: intOrNull("f_edad_hasta"),
    paginas: intOrNull("f_paginas"),
    portada_color: val("f_color"),
  };

  if (!body.slug || !body.titulo || !body.precio_centavos) {
    msg.textContent = "Falta slug, título o precio.";
    msg.style.color = "#D85A30";
    msg.style.display = "block";
    return;
  }

  const res = await fetch("/api/admin/libros", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    msg.textContent = "Libro guardado. Ahora puedes subirle el PDF desde la tabla de abajo.";
    msg.style.color = "#27500A";
    msg.style.display = "block";
    ["f_slug", "f_titulo", "f_descripcion", "f_precio", "f_categoria", "f_edad_desde", "f_edad_hasta", "f_paginas"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    cargarLibros();
  } else {
    const data = await res.json().catch(() => ({}));
    msg.textContent = "Error: " + (data.error || res.status);
    msg.style.color = "#D85A30";
    msg.style.display = "block";
  }
}

async function cargarLibros() {
  const res = await fetch("/api/admin/libros");
  if (!res.ok) return;
  const { libros } = await res.json();
  const tbody = document.getElementById("tablaLibros");
  tbody.innerHTML = libros
    .map(
      (l) => `
    <tr>
      <td><strong>${escapeHtml(l.titulo)}</strong><br><span style="color:var(--text-muted)">${escapeHtml(l.slug)}</span></td>
      <td>$${(l.precio_centavos / 100).toFixed(2)}</td>
      <td><span class="pill ${l.activo ? "on" : "off"}">${l.activo ? "Visible" : "Oculto"}</span></td>
      <td>${l.pdf_key ? "✅ cargado" : "— falta subir"}
        <br><label class="link-btn" style="cursor:pointer">
          Subir PDF
          <input type="file" accept="application/pdf" style="display:none" onchange="subirPdf(${l.id}, this.files[0])">
        </label>
      </td>
      <td><button class="link-btn" onclick="toggleActivo(${l.id}, ${l.activo ? 0 : 1})">${l.activo ? "Ocultar" : "Mostrar"}</button></td>
    </tr>`
    )
    .join("");
}

async function toggleActivo(id, nuevoValor) {
  // Trae el libro actual para no perder sus otros campos al actualizar
  const res = await fetch("/api/admin/libros");
  const { libros } = await res.json();
  const libro = libros.find((l) => l.id === id);
  if (!libro) return;
  libro.activo = nuevoValor;
  await fetch(`/api/admin/libros/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(libro),
  });
  cargarLibros();
}

async function subirPdf(id, file) {
  if (!file) return;
  await fetch(`/api/admin/libros/${id}/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  cargarLibros();
}

async function cargarPedidos() {
  const res = await fetch("/api/admin/pedidos");
  if (!res.ok) return;
  const { pedidos } = await res.json();
  const tbody = document.getElementById("tablaPedidos");
  tbody.innerHTML = pedidos
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.codigo)}</td>
      <td>${escapeHtml(p.titulo)}</td>
      <td>${escapeHtml(p.email_comprador)}</td>
      <td>${p.metodo_pago}</td>
      <td><span class="pill ${p.estado === "pagado" ? "on" : "off"}">${p.estado}</span></td>
      <td>${
        p.estado === "pendiente" && p.metodo_pago === "transferencia"
          ? `<button class="link-btn" onclick="confirmarTransferencia('${p.codigo}')">Confirmar pago</button>`
          : ""
      }</td>
    </tr>`
    )
    .join("");
}

async function confirmarTransferencia(codigo) {
  await fetch(`/api/admin/pedidos/${codigo}/confirmar-transferencia`, { method: "POST" });
  cargarPedidos();
}

// Utilidades
function val(id) {
  return document.getElementById(id).value.trim();
}
function intOrNull(id) {
  const v = val(id);
  return v === "" ? null : parseInt(v, 10);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
