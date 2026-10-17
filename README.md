# TPP Web Generator

Herramienta CLI para generar un nuevo módulo Angular a partir del base `tpp-web-base-ux` usando plantillas predefinidas o maquetas de negocio existentes.

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

Ejemplo no interactivo (CI) con plantilla:

```bash
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo --plantilla base --yes
```

Ejemplo con maqueta de negocio:

```bash
npx github:ahuapayatpp/tpp-web-generator --destino /ruta/al/nuevo-modulo --maqueta desgloses --yes
```

## Opciones principales

- `--origen <ruta|url>`: seed (URL o ruta).  
- `--destino <ruta>`: carpeta donde se crea el proyecto.  
- `--nombre <nombre>`: slug del módulo, opcional; si no se indica, usa el nombre de la carpeta destino.  
- `--plantilla <plantilla>`: `base | mantenimiento | detalle | monitoreo | dashboard`.  
- `--maqueta <nombre>`: nombre de la carpeta dentro de `modules/` en la rama de maquetas.  
- `--rama-base <rama>`: rama del seed con el proyecto base (default: `generalTPP`).  
- `--rama-maquetas <rama>`: rama del seed con las maquetas (default: `generalTPP-completo`).  
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
| `Maqueta de negocio existente` | Usa una carpeta de `modules/` de la rama `generalTPP-completo` |

> La plantilla `Dashboard` agrega automáticamente `chart.js` y `chartjs-plugin-datalabels` al `package.json` del proyecto generado.

## Maquetas de negocio

Además de las plantillas, el generador puede partir de una maqueta creada por el equipo de diseño. Solo necesitas conocer el nombre exacto de la carpeta dentro de `modules/`.

Flujo recomendado:

1. El diseñador crea la maqueta en `tpp-web-base-ux`, rama `generalTPP-completo`, carpeta `modules/<nombre-del-negocio>`.
2. El desarrollador clona el repositorio del nuevo módulo y ejecuta el generador dentro de esa carpeta.
3. En el menú interactivo elige **Maqueta de negocio existente** e ingresa el nombre de la carpeta.
4. El generador crea el proyecto con la base de `generalTPP`, traslada la maqueta y ajusta la identidad al nombre de la carpeta destino.

La identidad del proyecto siempre se deriva de la carpeta destino, no del nombre de la maqueta.

## Comportamiento

- El generador NUNCA modifica el base; siempre crea un nuevo proyecto en el `--destino` indicado.  
- El nombre del módulo se toma del nombre de la carpeta destino (se puede sobrescribir con `--nombre`).
- Si se ejecuta en un terminal interactivo, muestra selectores y confirmaciones interactivas.

## Ejemplo rápido

```bash
npx github:ahuapayatpp/tpp-web-generator --destino ./tpp-mi-modulo
```

