# TPP Web Generator

Herramienta CLI para generar un nuevo módulo Angular a partir del base `tpp-web-base-ux` usando plantillas predefinidas.

## Instalación

Ejecuta el paquete directamente desde el repositorio con npx:

```bash
npx github:ahuapayatpp/tpp-web-generator
```

## Uso

Ejemplo interactivo:

```bash
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo --nombre mi-modulo
```

Ejemplo no interactivo (CI):

```bash
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo --nombre mi-modulo --plantilla base --yes
```

## Opciones principales

- `--origen <ruta|url>`: seed (URL o ruta).  
- `--destino <ruta>`: carpeta donde se crea el proyecto.  
- `--nombre <nombre>`: slug del módulo.  
- `--plantilla <plantilla>`: `base | listado-base | listado-formulario | monitoreo`.  
- `--yes`: no pedir confirmación (modo CI).  
- `--force`: permitir generar en destino no vacío.  
- `--help`: mostrar ayuda.

## Comportamiento

- El generador NUNCA modifica el base; siempre crea un nuevo proyecto en el `--destino` indicado.  
- Si se ejecuta en un terminal interactivo, muestra selectores y confirmaciones interactivas.

## Ejemplo rápido

```bash
npx github:ahuapayatpp/tpp-web-generator --destino ./tpp-mi-modulo --nombre tpp-mi-modulo
```

