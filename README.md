# ideashopec-web

Sitio web de **ideashop EC** — venta de libros digitales para niños en formato PDF.
Paleta "Arcoíris de cuentos" · Fuentes Fredoka + Nunito.

Incluye el sitio público, un backend real (Cloudflare Worker + D1 + R2) y un
panel de administración en `/admin` para cargar libros nuevos sin tocar código.

## Estructura

```
public/              <- lo que se publica como sitio estático
  index.html          Home (catálogo cargado desde /api/libros)
  producto.html        Ficha de un libro (?slug=...)
  checkout.html         Flujo de pago (resumen -> método -> confirmación)
  descarga.html          Página del enlace de descarga (3 intentos o 72h)
  admin/index.html        Panel de administración (protegido con contraseña)
  css/styles.css

src/worker.js         <- backend: catálogo, checkout, webhook de pago,
                          descarga protegida, login y CRUD del admin

db/schema.sql         <- esquema D1: tablas libros, pedidos, descargas
                          (incluye 4 libros de ejemplo)

wrangler.toml         <- configuración de Cloudflare (assets + Worker + D1 + R2)
```

## Cómo funciona

- **Catálogo**: `index.html` y `producto.html` ya no tienen los libros escritos
  a mano — los piden a `/api/libros` (GET), que lee la tabla `libros` en D1.
- **Compra**: `checkout.html` crea un pedido (`POST /api/checkout`) y, según el
  método:
  - *Pasarela*: se simula la confirmación (`POST /api/pago/webhook-pasarela`).
    En producción esa llamada la hace la pasarela real (Payphone/PlacetoPay),
    no un botón del navegador — ver la nota de seguridad dentro de
    `src/worker.js`.
  - *Transferencia*: el pedido queda "pendiente" hasta que alguien lo confirma
    manualmente desde `/admin` (pestaña "Pedidos recientes").
- **Descarga**: al confirmarse el pago se genera un token en la tabla
  `descargas`, válido por 3 intentos o 72 horas (lo que ocurra primero).
  `descarga.html?token=...` consulta el estado sin gastar intento
  (`/api/descarga/:token/estado`) y solo descuenta uno cuando el comprador
  hace clic en "Descargar PDF ahora" (`/api/descarga/:token`).
- **Admin** (`/admin`): agregar libros, subir su PDF a R2, ocultarlos/mostrarlos,
  y confirmar transferencias pendientes. Protegido con una contraseña (secret
  `ADMIN_PASSWORD`) y una cookie de sesión firmada.

## Puesta en marcha (una sola vez)

Desde la terminal de VS Code, dentro de esta carpeta:

```bash
# 1) Crear la base de datos D1
npx wrangler d1 create ideashopec-db
# Copia el "database_id" que imprime y pégalo en wrangler.toml (línea database_id)

# 2) Aplicar el esquema a esa base
npx wrangler d1 execute ideashopec-db --remote --file=./db/schema.sql

# 3) Crear el bucket R2 para los PDFs
npx wrangler r2 bucket create ideashopec-libros

# 4) Configurar los secrets del panel admin
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # cualquier cadena larga y aleatoria
```

Después de esto, haz commit + push de `wrangler.toml` (con el `database_id`
ya completado) para que Cloudflare Pages tome la configuración y vuelva a
desplegar con el backend activo.

## Publicar en Cloudflare (Workers & Pages)

Ya está conectado a este repositorio (`crisplazat-blip/ideashopec-web`).
Cada `git push` a `main` dispara un build automático que ejecuta
`npx wrangler deploy`, publicando tanto el sitio estático como el Worker.

## Pendiente para producción real

- Verificar la firma/token real de la pasarela de pago en el webhook (hoy es
  un stub que confía en el body — ver el comentario en `src/worker.js`).
- Enviar el correo real con el link de descarga (Resend/Mailgun/Postmark) al
  confirmarse un pago, en vez de solo devolver el token en la respuesta.
- Reemplazar los cuadros de color de portada por imágenes reales (subida de
  portada desde `/admin`, o campo de URL de imagen).
