#!/usr/bin/env node

// Generador de módulos TPP.
// Crea un proyecto Angular nuevo en --destino a partir del seed
// tpp-web-base-ux y una plantilla elegida por el usuario.
//
// Uso:
//   node scripts/generar-modulo.mjs [--origen <ruta|url>] [--destino <ruta>]
//                                   [--nombre <nombre>] [--plantilla <plantilla>]
//                                   [--maqueta <nombre>] [--rama-base <rama>]
//                                   [--rama-maquetas <rama>] [--yes] [--force]
//                                   [--help]
//
//   --origen          Ruta local o URL git del seed (default: clone de CodeCommit).
//   --destino         Carpeta donde se crea el proyecto (default: directorio actual).
//   --nombre          Nombre del módulo (slug), opcional. Si no se pasa, usa el nombre de la carpeta.
//   --plantilla       base | mantenimiento | detalle | monitoreo | dashboard.
//   --maqueta         Nombre de la carpeta dentro de modules/ en la rama de maquetas.
//   --rama-base       Rama del seed que contiene el proyecto base (default: generalTPP).
//   --rama-maquetas   Rama del seed que contiene las maquetas (default: generalTPP-completo).
//   --yes             No pedir confirmación (modo CI).
//   --force           Permitir generar en un destino no vacío.
//
// El CLI NUNCA modifica el proyecto seed: siempre crea un proyecto nuevo en destino.

import { execFileSync } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as os from 'node:os';

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import prompts from 'prompts';

// --------------------------------------------------------------------------
// Configuración visual
// --------------------------------------------------------------------------

const COLORS = {
  primary: '#ff6c37',
  secondary: '#5b6670',
  success: '#82b536',
  warning: '#cf9f02',
  error: '#dc143c',
  muted: '#9da3a9',
};

const ICONS = (() => {
  const useAscii = process.platform === 'win32' && !process.env.WT_SESSION;
  return useAscii
    ? { ok: '[OK]', warn: '[!]', err: '[ERR]', arrow: '->', check: '[OK]' }
    : { ok: '✔', warn: '⚠', err: '✖', arrow: '→', check: '✔' };
})();

const CODECOMMIT_SEED = 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/tpp-web-base-ux';
const RAMA_BASE_DEFAULT = 'generalTPP';
const RAMA_MAQUETAS_DEFAULT = 'generalTPP-completo';
const NOMBRE_SUGERIDO = 'tpp-web-mi-modulo';
const OPCION_MAQUETA = '__MAQUETA__';

// --------------------------------------------------------------------------
// Utilidades visuales
// --------------------------------------------------------------------------

function printHeader() {
  const contenido = [
    chalk.hex(COLORS.primary).bold('TPP · Generador de módulos'),
    chalk.hex(COLORS.muted)('Crea un nuevo módulo a partir de base UX'),
  ].join('\n');

  console.log(
    boxen(contenido, {
      padding: 1,
      margin: { top: 0, bottom: 1, left: 0, right: 0 },
      borderStyle: 'double',
      borderColor: COLORS.primary,
    }),
  );
}

function printSection(titulo) {
  console.log(`\n${chalk.hex(COLORS.primary).bold(titulo)}\n`);
}

function printSuccess(mensaje) {
  console.log(chalk.hex(COLORS.success)(`${ICONS.ok} ${mensaje}`));
}

function printWarning(mensaje) {
  console.log(chalk.hex(COLORS.warning)(`${ICONS.warn} ${mensaje}`));
}

function printError(mensaje) {
  console.log(chalk.hex(COLORS.error)(`${ICONS.err} ${mensaje}`));
}

function printLabelValue(label, value) {
  console.log(
    `  ${chalk.hex(COLORS.muted)(label.padEnd(14))} ${chalk.white(value)}`,
  );
}

function parseArgs(argv) {
  const args = {
    origen: null,
    destino: process.cwd(),
    nombre: null,
    plantilla: null,
    maqueta: null,
    ramaBase: RAMA_BASE_DEFAULT,
    ramaMaquetas: RAMA_MAQUETAS_DEFAULT,
    yes: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--origen':
        args.origen = argv[++i];
        break;

      case '--destino':
        args.destino = argv[++i];
        break;

      case '--nombre':
        args.nombre = argv[++i];
        break;

      case '--plantilla':
        args.plantilla = argv[++i];
        break;

      case '--maqueta':
        args.maqueta = argv[++i];
        break;

      case '--rama-base':
        args.ramaBase = argv[++i];
        break;

      case '--rama-maquetas':
        args.ramaMaquetas = argv[++i];
        break;

      case '--yes':
        args.yes = true;
        break;

      case '--force':
        args.force = true;
        break;

      case '--help':
        args.help = true;
        break;

      default:
        throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  args.destino = path.resolve(args.destino);

  return args;
}

function esUrlGit(valor) {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(valor);
}

function gitLsFiles(seed, extra) {
  const out = execFileSync(
    'git',
    ['-C', seed, ...extra, '-z'],
    { encoding: 'utf8' },
  );

  return out.split('\0').filter(Boolean);
}

function normalizarSlug(valor) {
  return valor
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function humanizar(nombre) {
  return nombre
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --------------------------------------------------------------------------
// Resolución del seed
// --------------------------------------------------------------------------

async function resolverSeed(origen, rama) {
  const efectivo = origen ?? CODECOMMIT_SEED;

  if (esUrlGit(efectivo) || rama) {
    const tmp = await mkdtemp();

    try {
      const label = rama ? `rama '${rama}'` : 'seed';

      console.log(
        `${chalk.hex(COLORS.secondary)(ICONS.arrow)} Clonando ${label}...`,
      );

      const cloneArgs = ['clone', '--depth', '1'];

      if (rama) {
        cloneArgs.push('--branch', rama);
      }

      cloneArgs.push(efectivo, tmp);

      execFileSync(
        'git',
        cloneArgs,
        { stdio: 'inherit' },
      );

      return {
        seed: tmp,
        temporal: true,
      };
    } catch (err) {
      await rm(tmp, {
        recursive: true,
        force: true,
      });

      throw new Error(
        `No se pudo clonar el seed desde ${efectivo}${rama ? ` (rama '${rama}')` : ''}.`,
      );
    }
  }

  const seed = path.resolve(efectivo);

  if (!existsSync(path.join(seed, '.git'))) {
    throw new Error(
      `El directorio '${seed}' no es un repositorio git. Usa --origen con una ruta local o URL.`,
    );
  }

  try {
    execFileSync(
      'git',
      ['-C', seed, 'rev-parse', '--is-inside-work-tree'],
      { stdio: 'pipe' },
    );
  } catch {
    throw new Error(
      `El directorio '${seed}' no es un repositorio git.`,
    );
  }

  return {
    seed,
    temporal: false,
  };
}

async function mkdtemp() {
  const base = path.join(
    os.tmpdir(),
    'tpp-generador-',
  );

  return await (
    await import('node:fs/promises')
  ).mkdtemp(base);
}

// --------------------------------------------------------------------------
// Copiado del proyecto
// --------------------------------------------------------------------------

async function copiarProyecto(seed, destino) {
  const files = new Set([
    ...gitLsFiles(seed, ['ls-files']),
    ...gitLsFiles(seed, ['ls-files', '--others', '--exclude-standard']),
  ]);

  let copiados = 0;

  for (const rel of files) {
    const srcPath = path.join(seed, rel);

    if (rel.endsWith('/') || !existsSync(srcPath)) {
      continue;
    }

    const destPath = path.join(destino, rel);

    await mkdir(path.dirname(destPath), {
      recursive: true,
    });

    await copyFile(srcPath, destPath);

    copiados++;
  }

  return copiados;
}

// --------------------------------------------------------------------------
// Plantillas
// --------------------------------------------------------------------------

async function listarPlantillas(seed) {
  const plantillasDir = path.join(
    seed,
    'src',
    'assets',
    'plantillas',
  );

  const items = await readdir(
    plantillasDir,
    { withFileTypes: true },
  ).catch(() => []);

  const carpetas = items
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((nombre) =>
      existsSync(
        path.join(
          plantillasDir,
          nombre,
          `${nombre}.routes.ts`,
        ),
      ),
    );

  return ['base', ...carpetas];
}

const PLANTILLA_INFO = {
  base: {
    nombre: 'Base',
    descripcion:
      'Proyecto limpio para comenzar desde cero',
  },
  mantenimiento: {
    nombre: 'Mantenimiento',
    descripcion:
      'Gestionar registros: crear, editar, consultar, eliminar',
  },
  monitoreo: {
    nombre: 'Monitoreo',
    descripcion:
      'Seguimiento de operaciones y estados en tiempo real',
  },
  dashboard: {
    nombre: 'Dashboard',
    descripcion:
      'KPIs, indicadores y resumen operacional',
  },
  detalle: {
    nombre: 'Detalle',
    descripcion:
      'Ver información completa de una operación/registro',
  },
};

function obtenerNombrePlantilla(nombre) {
  return PLANTILLA_INFO[nombre]?.nombre ?? nombre;
}

function obtenerDescripcionPlantilla(nombre) {
  return (
    PLANTILLA_INFO[nombre]?.descripcion ??
    'Plantilla base para crear un módulo'
  );
}

// --------------------------------------------------------------------------
// Maquetas de negocio
// --------------------------------------------------------------------------

function obtenerRutaMaqueta(seedMaquetas, nombre) {
  return path.join(
    seedMaquetas,
    'modules',
    nombre,
  );
}

async function validarMaqueta(seedMaquetas, nombre) {
  const maquetaDir = obtenerRutaMaqueta(
    seedMaquetas,
    nombre,
  );

  if (!existsSync(maquetaDir)) {
    throw new Error(
      `No se encontró la maqueta '${nombre}' en modules/ de la rama de maquetas.`,
    );
  }

  const archivos = await readdir(maquetaDir);

  if (!archivos.some((f) => f.endsWith('.routes.ts'))) {
    throw new Error(
      `La maqueta '${nombre}' no tiene un archivo de rutas (*.routes.ts).`,
    );
  }

  return maquetaDir;
}

async function aplicarPlantilla(
  destino,
  plantillaNombre,
  plantillasDir,
) {
  const app = path.join(
    destino,
    'src',
    'app',
  );

  const plantillaDir = path.join(
    plantillasDir,
    plantillaNombre,
  );

  for (const sub of ['components', 'pages']) {
    const src = path.join(
      plantillaDir,
      sub,
    );

    if (existsSync(src)) {
      await cp(
        src,
        path.join(app, sub),
        {
          recursive: true,
          force: true,
        },
      );
    }
  }

  const core = path.join(
    plantillaDir,
    'core',
  );

  if (existsSync(core)) {
    await cp(
      core,
      path.join(app, 'core'),
      {
        recursive: true,
        force: true,
      },
    );
  }

  const rutasArchivo = (
    await readdir(plantillaDir)
  ).find((f) =>
    f.endsWith('.routes.ts'),
  );

  if (!rutasArchivo) {
    throw new Error(
      `La plantilla '${plantillaNombre}' no tiene archivo de rutas (*.routes.ts).`,
    );
  }

  await copyFile(
    path.join(plantillaDir, rutasArchivo),
    path.join(app, 'app.routes.ts'),
  );

  // Limpiar contenido base puro.
  await rm(
    path.join(
      app,
      'pages',
      'inicio',
    ),
    {
      recursive: true,
      force: true,
    },
  );

  await rm(
    path.join(
      app,
      'core',
      'models',
      'base.models.ts',
    ),
    {
      force: true,
    },
  );

  // La carpeta de plantillas pertenece al generador,
  // no al proyecto generado.
  await rm(
    path.join(
      destino,
      'src',
      'assets',
      'plantillas',
    ),
    {
      recursive: true,
      force: true,
    },
  );
}

// --------------------------------------------------------------------------
// Identidad del proyecto
// --------------------------------------------------------------------------

async function parametrizarIdentidad(
  destino,
  nombre,
) {
  const titulo = humanizar(nombre);

  const pkgPath = path.join(
    destino,
    'package.json',
  );

  const pkg = JSON.parse(
    await readFile(pkgPath, 'utf8'),
  );

  pkg.name = nombre;

  await writeFile(
    pkgPath,
    JSON.stringify(pkg, null, 2) + '\n',
    'utf8',
  );

  const angPath = path.join(
    destino,
    'angular.json',
  );

  const ang = JSON.parse(
    await readFile(angPath, 'utf8'),
  );

  if (ang.projects && ang.projects['tpp-web-base-ux']) {
    const proyecto = ang.projects['tpp-web-base-ux'];

    delete ang.projects['tpp-web-base-ux'];

    ang.projects[nombre] = proyecto;

    if (
      proyecto.architect?.build?.options?.outputPath
    ) {
      proyecto.architect.build.options.outputPath =
        `dist/${nombre}`;
    }

    for (
      const conf of Object.values(
        proyecto.architect?.serve?.configurations ?? {},
      )
    ) {
      if (conf?.buildTarget) {
        conf.buildTarget =
          conf.buildTarget.replace(
            /^tpp-web-base-ux/,
            nombre,
          );
      }
    }

    for (
      const conf of Object.values(
        proyecto.architect?.build?.configurations ?? {},
      )
    ) {
      if (conf?.baseHref) {
        conf.baseHref =
          `/${nombre}/browser/`;
      }
    }
  }

  await writeFile(
    angPath,
    JSON.stringify(ang, null, 2) + '\n',
    'utf8',
  );

  const idxPath = path.join(
    destino,
    'src',
    'index.html',
  );

  const idx = await readFile(
    idxPath,
    'utf8',
  );

  await writeFile(
    idxPath,
    idx.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${titulo}</title>`,
    ),
    'utf8',
  );

  const readmePath = path.join(
    destino,
    'README.md',
  );

  if (existsSync(readmePath)) {
    await writeFile(
      readmePath,
      `# ${nombre}\n`,
      'utf8',
    );
  }
}

// --------------------------------------------------------------------------
// Dependencias adicionales por plantilla
// --------------------------------------------------------------------------

async function agregarDependenciasDashboard(
  destino,
) {
  const pkgPath = path.join(
    destino,
    'package.json',
  );

  const pkg = JSON.parse(
    await readFile(pkgPath, 'utf8'),
  );

  pkg.dependencies = pkg.dependencies ?? {};

  pkg.dependencies['chart.js'] = '^4.5.1';
  pkg.dependencies['chartjs-plugin-datalabels'] =
    '^2.2.0';

  await writeFile(
    pkgPath,
    JSON.stringify(pkg, null, 2) + '\n',
    'utf8',
  );
}

// --------------------------------------------------------------------------
// Wizard
// --------------------------------------------------------------------------

async function pedir(
  rl,
  pregunta,
  validar,
) {
  for (let i = 0; i < 5; i++) {
    const respuesta = (
      await rl.question(pregunta)
    ).trim();

    if (!respuesta) {
      return null;
    }

    const error = validar
      ? validar(respuesta)
      : null;

    if (!error) {
      return respuesta;
    }

    printError(error);
  }

  throw new Error(
    'Demasiados intentos fallidos.',
  );
}

function validarNombre(nombre) {
  return /^[a-z][a-z0-9_-]*$/.test(nombre)
    ? null
    : 'Solo minúsculas, números, guiones y guiones bajos; debe empezar por letra.';
}

function normalizarPlantilla(
  valor,
  plantillas,
) {
  const v =
    valor.toLowerCase();

  const porNumero =
    /^[0-9]+$/.test(v);

  if (porNumero) {
    const idx = parseInt(v, 10);

    if (
      idx >= 1 &&
      idx <= plantillas.length
    ) {
      return plantillas[idx - 1];
    }

    return null;
  }

  return plantillas.includes(v)
    ? v
    : null;
}

// --------------------------------------------------------------------------
// Validaciones del destino
// --------------------------------------------------------------------------

const DESTINO_PERMITIDO = new Set([
  '.git',
  '.gitignore',
  'README.md',
  'README',
]);

async function validarDestino(
  destino,
  seed,
  force,
) {
  if (
    path.resolve(destino) ===
    path.resolve(seed)
  ) {
    throw new Error(
      'El destino es el propio seed (tpp-web-base-ux). El generador nunca modifica el seed; ejecútalo en el repo vacío del nuevo módulo o usa --destino.',
    );
  }

  if (force) {
    return;
  }

  const items = await readdir(
    destino,
    {
      withFileTypes: true,
    },
  ).catch(() => []);

  const bloqueantes = items.filter(
    (i) =>
      !DESTINO_PERMITIDO.has(i.name),
  );

  if (bloqueantes.length > 0) {
    const nombres = bloqueantes
      .slice(0, 8)
      .map((i) => i.name)
      .join(', ');

    throw new Error(
      `El destino '${destino}' no está vacío (${nombres}${bloqueantes.length > 8 ? ', ...' : ''}). Usa --force si estás seguro.`,
    );
  }
}

// --------------------------------------------------------------------------
// Ayuda
// --------------------------------------------------------------------------

function mostrarAyuda() {
  console.log(`
${chalk.hex(COLORS.primary).bold('TPP · Generador de módulos')}

Crea un nuevo módulo Angular a partir del seed
tpp-web-base-ux y una plantilla elegida.

${chalk.bold('Uso:')}

  node scripts/generar-modulo.mjs [opciones]

${chalk.bold('Opciones:')}

  --origen <ruta|url>
      Ruta local o URL git del seed.
      Default: clone de CodeCommit.

  --destino <ruta>
      Carpeta donde se crea el proyecto.
      Default: directorio actual.

  --nombre <nombre>
      Nombre del módulo (slug), opcional.
      Si no se indica, usa el nombre de la carpeta destino.

  --plantilla <plantilla>
      Plantilla a utilizar:
      base | mantenimiento | detalle | monitoreo | dashboard

  --maqueta <nombre>
      Nombre de la carpeta dentro de modules/ en la rama de maquetas.
      Ejemplo: desgloses

  --rama-base <rama>
      Rama del seed que contiene el proyecto base.
      Default: generalTPP

  --rama-maquetas <rama>
      Rama del seed que contiene las maquetas.
      Default: generalTPP-completo

  --yes
      No pedir confirmación.

  --force
      Permitir generar en un destino no vacío.

  --help
      Mostrar esta ayuda.

${chalk.hex(COLORS.muted)(
  'El CLI nunca modifica el proyecto seed.'
)}
`);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const args = parseArgs(
    process.argv.slice(2),
  );

  if (args.help) {
    mostrarAyuda();
    return;
  }

  if (args.plantilla && args.maqueta) {
    throw new Error(
      'No puedes usar --plantilla y --maqueta al mismo tiempo. Elige solo uno.',
    );
  }

  printHeader();

  const {
    seed: seedBase,
    temporal: temporalBase,
  } = await resolverSeed(
    args.origen,
    args.ramaBase,
  );

  let seedMaquetas = null;
  let temporalMaquetas = false;

  try {
    const plantillas =
      await listarPlantillas(seedBase);

    if (plantillas.length === 0) {
      throw new Error(
        'No se encontraron plantillas en el seed (src/assets/plantillas).',
      );
    }

    // ----------------------------------------------------------------------
    // 1. Validar destino
    // ----------------------------------------------------------------------

    await validarDestino(
      args.destino,
      seedBase,
      args.force,
    );

    // ----------------------------------------------------------------------
    // 2. Wizard
    // ----------------------------------------------------------------------

    const rl =
      readline.createInterface({
        input: stdin,
        output: stdout,
      });

    const nombre =
      args.nombre ??
      (normalizarSlug(
        path.basename(
          args.destino,
        ),
      ) ||
        NOMBRE_SUGERIDO);

    if (validarNombre(nombre)) {
      throw new Error(
        `Nombre inválido derivado de la carpeta destino: '${path.basename(
          args.destino,
        )}' -> '${nombre}'. Usa --nombre <slug> para indicar otro nombre.`,
      );
    }

    let plantilla = args.plantilla
      ? normalizarPlantilla(
          args.plantilla,
          plantillas,
        )
      : null;

    let maquetaNombre = args.maqueta ?? null;

    if (maquetaNombre) {
      plantilla = OPCION_MAQUETA;
    }

    if (!plantilla) {
      if (args.plantilla) {
        throw new Error(
          `Plantilla desconocida: '${args.plantilla}'. Disponibles: ${plantillas.join(', ')}.`,
        );
      }

      if (
        process.stdin.isTTY &&
        process.stdout.isTTY
      ) {
        printSection(
          'Punto de partida',
        );

        const choices = [
          ...plantillas.map(
            (p) => ({
              title:
                obtenerNombrePlantilla(
                  p,
                ),
              description:
                obtenerDescripcionPlantilla(
                  p,
                ),
              value: p,
            }),
          ),
          {
            title: 'Maqueta de negocio existente',
            description:
              'Usa una carpeta de modules/ de la rama de maquetas',
            value: OPCION_MAQUETA,
          },
        ];

        try {
          const res =
            await prompts({
              type: 'select',
              name: 'plantilla',
              message:
                'Selecciona un punto de partida',
              choices,
              initial: 0,
            });

          if (
            res.plantilla ===
            undefined
          ) {
            throw new Error(
              'cancelled',
            );
          }

          plantilla =
            res.plantilla;
        } catch (e) {
          console.log(
            '\nOpciones disponibles:',
          );

          choices.forEach(
            (c, i) => {
              console.log(
                `  ${chalk.hex(
                  COLORS.secondary,
                )(`[${i + 1}]`)} ${chalk.bold(
                  c.title,
                )}`,
              );

              if (c.description) {
                console.log(
                  `      ${chalk.hex(
                    COLORS.muted,
                  )(c.description)}`,
                );
              }
            },
          );

          const elegida =
            await pedir(
              rl,
              `\nSelecciona una opción [1]: `,
              (v) => {
                const idx = parseInt(v, 10);

                if (
                  Number.isInteger(idx) &&
                  idx >= 1 &&
                  idx <= choices.length
                ) {
                  return null;
                }

                return `Disponibles: 1-${choices.length}.`;
              },
            );

          plantilla =
            choices[parseInt(elegida ?? '1', 10) - 1].value;
        }
      } else {
        console.log(
          '\nOpciones disponibles:',
        );

        const choices = [
          ...plantillas.map(
            (p) => ({
              title: obtenerNombrePlantilla(p),
              description: obtenerDescripcionPlantilla(p),
              value: p,
            }),
          ),
          {
            title: 'Maqueta de negocio existente',
            description:
              'Usa una carpeta de modules/ de la rama de maquetas',
            value: OPCION_MAQUETA,
          },
        ];

        choices.forEach(
          (c, i) => {
            console.log(
              `  ${chalk.hex(
                COLORS.secondary,
              )(`[${i + 1}]`)} ${chalk.bold(
                c.title,
              )}`,
            );

            if (c.description) {
              console.log(
                `      ${chalk.hex(
                  COLORS.muted,
                )(c.description)}`,
              );
            }
          },
        );

        const elegida =
          await pedir(
            rl,
            `\nSelecciona una opción [1]: `,
            (v) => {
              const idx = parseInt(v, 10);

              if (
                Number.isInteger(idx) &&
                idx >= 1 &&
                idx <= choices.length
              ) {
                return null;
              }

              return `Disponibles: 1-${choices.length}.`;
            },
          );

        plantilla =
          choices[parseInt(elegida ?? '1', 10) - 1].value;
      }
    }

    // ----------------------------------------------------------------------
    // 2.1 Resolver maqueta si aplica
    // ----------------------------------------------------------------------

    if (plantilla === OPCION_MAQUETA) {
      if (!maquetaNombre) {
        maquetaNombre = (
          await pedir(
            rl,
            '\nNombre exacto de la carpeta dentro de modules/: ',
            (v) =>
              v.trim().length > 0
                ? null
                : 'Ingresa el nombre de la carpeta.',
          )
        )?.trim();
      }

      if (!maquetaNombre) {
        throw new Error(
          'Debes indicar el nombre de la maqueta.',
        );
      }

      if (!seedMaquetas) {
        const resolved = await resolverSeed(
          args.origen,
          args.ramaMaquetas,
        );

        seedMaquetas = resolved.seed;
        temporalMaquetas = resolved.temporal;
      }

      await validarMaqueta(seedMaquetas, maquetaNombre);
    }

    // ----------------------------------------------------------------------
    // 3. Resumen y confirmación
    // ----------------------------------------------------------------------

    printSection(
      'Resumen',
    );

    if (plantilla === OPCION_MAQUETA) {
      printLabelValue(
        'Maqueta',
        maquetaNombre,
      );
    } else {
      printLabelValue(
        'Plantilla',
        obtenerNombrePlantilla(plantilla),
      );
    }

    printLabelValue(
      'Identidad',
      nombre,
    );

    printLabelValue(
      'Seed',
      `${seedBase}${
        temporalBase
          ? ' (clone temporal)'
          : ''
      }`,
    );

    if (!args.yes) {
      let confirmado = true;

      if (
        process.stdin.isTTY &&
        process.stdout.isTTY
      ) {
        try {
          const res = await prompts({
            type: 'select',
            name: 'ok',
            message: '¿Crear este módulo?',
            choices: [
              { title: 'Sí', value: true },
              { title: 'No', value: false },
            ],
            initial: 0,
          });

          confirmado = res.ok === true;
        } catch {
          confirmado = false;
        }
      } else {
        const confirmacion =
          await pedir(
            rl,
            '\n¿Crear el módulo? (s/N): ',
            (v) =>
              [
                's',
                'S',
                'n',
                'N',
                'y',
                'Y',
                '',
              ].includes(v)
                ? null
                : 'Responde s o n.',
          );

        confirmado =
          !!confirmacion &&
          !/^n$/i.test(
            confirmacion,
          );
      }

      if (!confirmado) {
        printWarning(
          'Generación cancelada.',
        );

        rl.close();
        return;
      }
    }

    rl.close();

    // ----------------------------------------------------------------------
    // 4. Copiar proyecto
    // ----------------------------------------------------------------------

    const sCopy = ora(
      'Copiando proyecto...',
    ).start();

    try {
      const copiados =
        await copiarProyecto(
          seedBase,
          args.destino,
        );

      sCopy.succeed(
        `Proyecto copiado · ${copiados} archivos`,
      );
    } catch (err) {
      sCopy.fail(
        'Error al copiar proyecto',
      );

      throw err;
    }

    // ----------------------------------------------------------------------
    // 5. Aplicar plantilla
    // ----------------------------------------------------------------------

    if (plantilla !== 'base') {
      const label =
        plantilla === OPCION_MAQUETA
          ? `maqueta '${maquetaNombre}'`
          : `plantilla '${obtenerNombrePlantilla(plantilla)}'`;

      const sTpl = ora(
        `Aplicando ${label}...`,
      ).start();

      try {
        const plantillasDir =
          plantilla === OPCION_MAQUETA
            ? path.join(seedMaquetas, 'modules')
            : path.join(
                seedBase,
                'src',
                'assets',
                'plantillas',
              );

        const nombreAplicar =
          plantilla === OPCION_MAQUETA
            ? maquetaNombre
            : plantilla;

        await aplicarPlantilla(
          args.destino,
          nombreAplicar,
          plantillasDir,
        );

        sTpl.succeed(
          `${label.charAt(0).toUpperCase() + label.slice(1)} aplicada`,
        );
      } catch (err) {
        sTpl.fail(
          `Error al aplicar ${label}`,
        );

        throw err;
      }
    }

    // ----------------------------------------------------------------------
    // 6. Parametrizar identidad
    // ----------------------------------------------------------------------

    const sIdentity = ora(
      'Configurando identidad del módulo...',
    ).start();

    try {
      await parametrizarIdentidad(
        args.destino,
        nombre,
      );

      sIdentity.succeed(
        'Identidad del módulo configurada',
      );
    } catch (err) {
      sIdentity.fail(
        'Error al configurar la identidad',
      );

      throw err;
    }

    if (plantilla === 'dashboard') {
      const sDeps = ora(
        'Agregando dependencias de gráficos (chart.js)...',
      ).start();

      try {
        await agregarDependenciasDashboard(
          args.destino,
        );

        sDeps.succeed(
          'chart.js y chartjs-plugin-datalabels agregados',
        );
      } catch (err) {
        sDeps.fail(
          'Error al agregar dependencias de gráficos',
        );

        throw err;
      }
    }

    // ----------------------------------------------------------------------
    // 7. Resultado final
    // ----------------------------------------------------------------------

    const lines = [
      chalk.hex(COLORS.primary).bold(
        `${ICONS.check} Módulo creado correctamente`,
      ),
      '',
      chalk.bold(nombre),
      '',
      chalk.hex(COLORS.secondary)(
        'Siguientes pasos',
      ),
      '',
      chalk.hex(COLORS.muted)(
        'npm install',
      ),
      chalk.hex(COLORS.muted)(
        'npm start',
      ),
      '',
      /* `${chalk.hex(COLORS.muted)(
        'Plantilla',
      )}  ${plantilla}`, */
    ];

    if (plantilla === 'base') {
      lines.push(
        '',
        chalk.hex(COLORS.muted)(
          'Puedes utilizar la carpeta de plantillas, AGENTS.md',
        ),
        chalk.hex(COLORS.muted)(
          'y especificaciones-ui/ como referencia para crear',
        ),
        chalk.hex(COLORS.muted)(
          'un módulo desde cero.',
        ),
      );
    } /* else {
      lines.push(
        '',
        chalk.hex(COLORS.muted)(
          `La plantilla '${obtenerNombrePlantilla(
          plantilla,
        )}' se aplicó en src/app.`,
        ),
        chalk.hex(COLORS.muted)(
          'La carpeta de plantillas fue eliminada del proyecto generado.',
        ),
      );
    } */

    console.log(
      boxen(
        lines.join('\n'),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'double',
          borderColor:
            COLORS.primary,
        },
      ),
    );
  } finally {
    if (temporalBase) {
      await rm(seedBase, {
        recursive: true,
        force: true,
      });
    }

    if (temporalMaquetas && seedMaquetas) {
      await rm(seedMaquetas, {
        recursive: true,
        force: true,
      });
    }
  }
}

main().catch((err) => {
  printError(err.message);
  process.exitCode = 1;
});
