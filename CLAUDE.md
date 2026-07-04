# CLAUDE.md

Repo de contenido de **jóvenes x transparencia**: artículos de opinión en markdown + `index.json`, consumidos por una SPA en Vue vía `raw.githubusercontent.com` (o GitHub Pages). Publicar = hacer push a `main`.

## Tarea principal: convertir Word nuevos a markdown

Cuando el usuario deje archivos `.docx` nuevos (normalmente en `inbox/`) o pida convertir artículos:

```bash
node scripts/sync.mjs                  # procesa inbox/
node scripts/sync.mjs <archivo.zip>    # zip completo descargado de Drive
node scripts/sync.mjs <carpeta>        # carpeta con .docx (recursivo)
node scripts/sync.mjs <archivo.docx>   # un solo artículo
```

Después de convertir: revisar el resumen y los errores reportados, mostrar al usuario qué se convirtió, y **commitear y pushear** (eso es lo que publica). Borrar de `inbox/` los archivos ya procesados.

## Convención de los .docx

- Nombre del archivo: `DD-MM-AA Autor.docx` (año de 2 o 4 dígitos, ej. `01-07-21 David Chávez.docx`). La fecha y el autor del frontmatter salen **del nombre del archivo**.
- Dentro del documento: primera línea = título, segunda línea = autor (el script la descarta del cuerpo), resto = contenido.
- Editoriales sin autor: renombrar a `DD-MM-AAAA Editorial.docx` (autor "Editorial"). El `07-03-2023.docx` del zip histórico es uno ya convertido — su error en re-corridas del zip completo es esperado, ignorarlo.
- Si un nombre no sigue el patrón, el script lo reporta al final y sigue con el resto. Corregir el nombre y volver a correr.

## Reglas del script

- **Incremental**: si el `.md` destino ya existe, lo salta — las correcciones manuales en `content/` sobreviven. `--force` reconvierte desde el .docx (pisa ediciones manuales de esos artículos).
- `index.json` se **regenera en cada corrida** leyendo los `.md` de `content/`. Nunca editarlo a mano.
- Salida: `content/<año>/<AAAA-MM-DD>-<slug-del-título>.md` con frontmatter `title`, `author`, `date`.

## Autores: vigilar duplicados

Muchos autores aparecen con grafías distintas ("Kevin Segura" vs "Kevin Segura Carrillo"). `scripts/aliases.json` mapea variante → nombre canónico y se aplica al convertir. **Al agregar artículos nuevos, comparar los autores nuevos contra el índice** (buscar slugs que sean prefijo de otros) y agregar aliases si hace falta; para aplicar un alias a artículos ya convertidos, corregir el campo `author` del `.md` a mano o reconvertir ese archivo con `--force`.

Pendientes conocidos: dos artículos coescritos conservan ambos nombres en un solo campo `author` ("Pablo Velásquez, José Daniel González" y "Sofía Alejandra Rodríguez Navarrete  Héctor Raúl del Valle Muñoz") — el esquema es de autor único y el usuario aún no decidió cómo tratarlos. "Lisa Marie Villela Egiizabal" probablemente sea un typo de "Eguizábal" arrastrado de Drive; confirmar con el usuario antes de corregir.

## Particularidades del entorno

- **Zips de Drive: usar `ditto -x -k`, nunca `unzip`** — los nombres traen UTF-8 sin marcar y `unzip` falla con "Illegal byte sequence". El script ya lo hace.
- Esta carpeta vive en iCloud Drive: `node_modules` es un symlink a `node_modules.nosync` para que iCloud no sincronice las dependencias. Si falta, recrear con `ln -sfn node_modules.nosync node_modules && npm install`.
- Archivos `~$*.docx` son temporales de Word; el script los ignora.
- `articulos.zip` (fuente histórica) e `inbox/` están gitignorados: al repo solo van `content/`, `index.json`, `scripts/` y estos archivos de configuración.
