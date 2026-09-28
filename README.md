# ideashopec-web

Sitio web de **ideashop EC** — venta de libros digitales para niños en formato PDF.
Paleta "Arcoíris de cuentos" · Fuentes Fredoka + Nunito.

Este repositorio contiene el mockup navegable ya diseñado, empaquetado como
HTML/CSS/JS estático, listo para publicarse en **Cloudflare Pages**.

## Estructura

```
public/            <- esto es lo que se publica (carpeta de salida del build)
  index.html       <- Home
  producto.html    <- Ficha de un libro
  checkout.html    <- Flujo de pago (resumen -> método -> pasarela/transferencia -> confirmación)
  descarga.html    <- Página del enlace de descarga (3 intentos o 72h)
  css/styles.css   <- Estilos y variables de color compartidas

functions/api/     <- (vacía por ahora) futuros endpoints backend:
                      crear pedido, webhook de la pasarela, validar token de descarga, etc.

wrangler.toml      <- configuración de Cloudflare (Pages + D1 + R2), con las
                      secciones de base de datos y almacenamiento comentadas
                      hasta que se creen esos recursos.
```

## Cómo verlo localmente

No necesita instalación: abre `public/index.html` directamente en el navegador,
o sirve la carpeta con cualquier servidor estático, por ejemplo:

```bash
npx serve public
```

## Publicar en Cloudflare Pages

1. Sube este repositorio a GitHub (ya está conectado a `ideashopec-web`).
2. En Cloudflare Pages: **Create a project → Connect to Git** y selecciona el repo.
3. Build settings:
   - Build command: *(vacío, no hay build)*
   - Build output directory: `public`
4. Cada `git push` a la rama principal despliega automáticamente.

## Estado actual

Esta es la maqueta funcional (navegación y simulación del contador de
descargas con JavaScript en el navegador). El pago real, el envío de correo y
la validación segura del token de descarga (3 usos / 72h) se implementan
después en `functions/api/`, usando D1 (base de datos) y R2 (almacenamiento
de los PDF), como se definió en el diseño de arquitectura.
