# Inventario · Grupo Surface — app instalable

App del inventario de almacenes para instalar en el celular. Funciona **con o sin señal**:

- **Buscar y escanear** responde al instante con la copia guardada en el celular.
- **Cada movimiento** (entrada, salida, traslado, conteo…) se guarda primero en el celular y se sube solo a la hoja de Google cuando hay conexión.
- El botón de arriba indica el estado: `✓` todo subido · `☁️ 2` subiendo · `📴 2` sin señal, 2 por subir · `⚠️ 1` revisar.

**Los datos no están aquí.** Este repositorio solo tiene la pantalla de la app. Los productos, el stock y los movimientos viven en la hoja de Google de la empresa, y sin usuario y PIN no se ve nada.

## Instalar en el celular
1. Abre el enlace de la app en **Chrome**.
2. Entra con tu usuario y PIN (la primera vez necesitas internet).
3. Menú ⋮ → **Instalar app** (o "Agregar a pantalla principal").

## Archivos
| Archivo | Para qué |
|---|---|
| `index.html` | Pantalla de la app (misma que la web, versión 2.4) |
| `offline.js` | Copia local, cola de movimientos y sincronización |
| `sw.js` | Guarda la app en el celular para abrirla sin señal |
| `manifest.webmanifest`, `icons/` | Nombre e ícono al instalarla |

Requiere el **Código.gs v2.4** en Apps Script (agrega la función `doPost`, `snapshot` y `sincronizar`). La web actual sigue funcionando igual.
