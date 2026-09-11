# Deploy permanente (Render)

Esta guia deja tu app Shop-MCP funcionando 24/7 sin depender de `shopify app dev`.

## 1) Subir este proyecto a GitHub

Sube esta carpeta completa a un repo:

- `shop-mcp-web-min/shop-mcp`

## 2) Crear servicio en Render

En Render:

1. New + > Blueprint
2. Conecta el repo
3. Render detecta `render.yaml`
4. Crea el servicio

## 3) Configurar variables en Render

En el servicio Web, define:

- `SHOPIFY_API_KEY`: `8c06c1772b384c7173ae092a5da9fad3`
- `SHOPIFY_API_SECRET`: tu secreto real de la app
- `SHOPIFY_APP_URL`: URL publica final de Render (ejemplo: `https://shop-mcp-web.onrender.com`)
- `DATABASE_URL`: `file:/var/data/dev.sqlite`
- `NODE_ENV`: `production`
- `HOST`: `0.0.0.0`
- `SCOPES`: `write_products,read_products,write_metaobjects,read_metaobjects,write_metaobject_definitions,read_metaobject_definitions`

## 4) Deploy en Render

Pulsa Manual Deploy > Deploy latest commit.

Cuando termine, verifica que abra:

- `https://TU-SERVICIO.onrender.com`

## 5) Publicar URL final en Shopify

En local, dentro de `shop-mcp-web-min/shop-mcp`, ejecuta:

```powershell
scripts\publicar-url-produccion.bat https://TU-SERVICIO.onrender.com
```

Ese comando actualiza y publica automaticamente:

- `application_url`
- `redirect_urls`

## 6) Verificar en Shopify Admin

1. Abre `AnanCom > Apps > Shop-MCP (shop-mcp-23)`
2. Debe cargar aunque tu terminal local este cerrada.

## Notas importantes

- La URL `trycloudflare.com` es temporal.
- Si cambias dominio de hosting, repite paso 5.
- Este setup usa SQLite con disco persistente de Render (simple y suficiente para una instancia).
