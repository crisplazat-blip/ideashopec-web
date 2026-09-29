-- Esquema D1 — ideashop EC
-- Aplicar con:
--   npx wrangler d1 execute ideashopec-db --file=./db/schema.sql            (local, para probar)
--   npx wrangler d1 execute ideashopec-db --remote --file=./db/schema.sql   (contra la base real en Cloudflare)

CREATE TABLE IF NOT EXISTS libros (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT UNIQUE NOT NULL,       -- usado en la URL: producto.html?slug=...
  titulo           TEXT NOT NULL,
  descripcion      TEXT,
  precio_centavos  INTEGER NOT NULL,           -- $4,99 => 499
  edad_desde       INTEGER,
  edad_hasta       INTEGER,
  paginas          INTEGER,
  categoria        TEXT,                        -- Amistad | Aventura | Familia | Emociones
  portada_color    TEXT DEFAULT '#4FB4E8',       -- color de portada mientras no haya imagen real
  etiqueta         TEXT,                         -- "Más vendido" | "Nuevo" | null
  pdf_key          TEXT,                         -- key del archivo en el bucket R2
  activo           INTEGER NOT NULL DEFAULT 1,   -- 1 visible en la tienda, 0 oculto
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedidos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo             TEXT UNIQUE NOT NULL,        -- ej. IE-20481, se muestra al comprador
  libro_id           INTEGER NOT NULL REFERENCES libros(id),
  email_comprador    TEXT NOT NULL,
  metodo_pago        TEXT NOT NULL,               -- 'pasarela' | 'transferencia'
  estado             TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagado | rechazado
  monto_centavos     INTEGER NOT NULL,
  referencia_pasarela TEXT,                       -- id de transacción que devuelva Payphone/PlacetoPay
  creado_en          TEXT NOT NULL DEFAULT (datetime('now')),
  confirmado_en      TEXT
);

CREATE TABLE IF NOT EXISTS descargas (
  token               TEXT PRIMARY KEY,           -- token largo y aleatorio, va en el link del correo
  pedido_id           INTEGER NOT NULL REFERENCES pedidos(id),
  intentos_restantes  INTEGER NOT NULL DEFAULT 3,
  expira_en           TEXT NOT NULL,               -- ISO datetime, ahora + 72h al generarse
  creado_en           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pedidos_libro ON pedidos(libro_id);
CREATE INDEX IF NOT EXISTS idx_descargas_pedido ON descargas(pedido_id);

-- Datos de ejemplo, para no empezar con la tienda vacía la primera vez
-- (bórralos o edítalos desde el panel /admin cuando quieras).
INSERT OR IGNORE INTO libros (slug, titulo, descripcion, precio_centavos, edad_desde, edad_hasta, paginas, categoria, portada_color, etiqueta)
VALUES
('bosque-de-nico', 'El bosque de Nico y las estrellas', 'Un cuento ilustrado para niños de 4 a 8 años sobre la amistad y la noche. 28 páginas a todo color.', 499, 4, 8, 28, 'Amistad', '#4FB4E8', 'Más vendido'),
('ballena-que-queria-volar', 'La ballena que quería volar', 'Una historia tierna sobre perseguir los sueños, para niños de 5 a 9 años.', 499, 5, 9, 24, 'Aventura', '#5FC77E', 'Nuevo'),
('dragon-sin-miedo', 'Un dragón sin miedo a la oscuridad', 'Un cuento sobre superar los miedos nocturnos, para niños de 3 a 7 años.', 499, 3, 7, 20, 'Emociones', '#FF7A5C', NULL),
('mi-primer-dia-compartiendo', 'Mi primer día compartiendo', 'Una historia sobre aprender a compartir, para niños de 3 a 6 años.', 399, 3, 6, 18, 'Familia', '#FFC93C', NULL);
