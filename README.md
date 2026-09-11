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
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo
```

Ejemplo no interactivo (CI):

```bash
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo --plantilla base --yes
```

## Opciones principales

- `--origen <ruta|url>`: seed (URL o ruta).  
- `--destino <ruta>`: carpeta donde se crea el proyecto.  
- `--nombre <nombre>`: slug del módulo, opcional; si no se indica, usa el nombre de la carpeta destino.  
- `--plantilla <plantilla>`: `base | mantenimiento | detalle | monitoreo | dashboard`.  
- `--yes`: no pedir confirmación (modo CI).  
- `--force`: permitir generar en destino no vacío.  
- `--help`: mostrar ayuda.

## Plantillas

| Plantilla | Descripción |
| --- | --- |
| `Mantenimiento` | Gestionar registros: crear, editar, consultar, eliminar |
| `Monitoreo` | Seguimiento de operaciones y estados en tiempo real |
| `Dashboard` | KPIs, indicadores y resumen operacional |
| `Detalle` | Ver información completa de una operación/registro |
| `Base` | Proyecto limpio para comenzar desde cero |

> La plantilla `Dashboard` agrega automáticamente `chart.js` y `chartjs-plugin-datalabels` al `package.json` del proyecto generado.

## Comportamiento

- El generador NUNCA modifica el base; siempre crea un nuevo proyecto en el `--destino` indicado.  
- El nombre del módulo se toma del nombre de la carpeta destino (se puede sobrescribir con `--nombre`).
- Si se ejecuta en un terminal interactivo, muestra selectores y confirmaciones interactivas.

## Ejemplo rápido

```bash
npx github:ahuapayatpp/tpp-web-generator --destino ./tpp-mi-modulo
```

