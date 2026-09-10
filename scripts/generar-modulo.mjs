#!/usr/bin/env node

// Generador de módulos TPP.
// Crea un proyecto Angular nuevo en --destino a partir del seed
// tpp-web-base-ux y una plantilla elegida por el usuario.
//
// Uso:
//   node scripts/generar-modulo.mjs [--origen <ruta|url>] [--destino <ruta>]
//                                   [--nombre <nombre>] [--plantilla <plantilla>]
//                                   [--yes] [--force] [--help]
//
//   --origen     Ruta local o URL git del seed (default: clone de CodeCommit).
//   --destino    Carpeta donde se crea el proyecto (default: directorio actual).
//   --nombre     Nombre del módulo (slug). Si no se pasa, usa el nombre de la carpeta.
//   --plantilla  base | listado-base | listado-formulario | monitoreo.
//   --yes        No pedir confirmación (modo CI).
//   --force      Permitir generar en un destino no vacío.
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
  primary: '#FF6C37',
  secondary: '#00A3E0',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  muted: '#94A3B8',
};

const CODECOMMIT_SEED = 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/tpp-web-base-ux';
const NOMBRE_SUGERIDO = 'tpp-web-mi-modulo';

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
      borderStyle: 'round',
      borderColor: COLORS.primary,
    }),
  );
}

function printSection(titulo) {
  console.log(`\n${chalk.hex(COLORS.primary).bold(titulo)}\n`);
}

function printSuccess(mensaje) {
  console.log(chalk.hex(COLORS.success)(`✔ ${mensaje}`));
}

function printWarning(mensaje) {
  console.log(chalk.hex(COLORS.warning)(`⚠ ${mensaje}`));
}

function printError(mensaje) {
  console.log(chalk.hex(COLORS.error)(`✖ ${mensaje}`));
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

async function resolverSeed(origen) {
  const efectivo = origen ?? CODECOMMIT_SEED;

  if (esUrlGit(efectivo)) {
    const tmp = await mkdtemp();

    try {
      console.log(
        `${chalk.hex(COLORS.secondary)('→')} Clonando seed...`,
      );

      execFileSync(
        'git',
        ['clone', '--depth', '1', efectivo, tmp],
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
        `No se pudo clonar el seed desde ${efectivo}.`,
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

function obtenerDescripcionPlantilla(nombre) {
  const descripciones = {
    base: 'Proyecto limpio para comenzar desde cero',
    'listado-base': 'Proyecto base para mantenimiento de registros',
    'listado-formulario': 'Proyecto para mantenimiento con formularios extensos',
    'monitoreo-base': 'Proyecto para seguimiento operacional',
    monitoreo: 'Proyecto para seguimiento operacional',
  };

  return (
    descripciones[nombre] ??
    'Plantilla base para crear un módulo'
  );
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

  if (ang.projects && ang.projects['tpp-base']) {
    const proyecto = ang.projects['tpp-base'];

    delete ang.projects['tpp-base'];

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
            /^tpp-base/,
            nombre,
          );
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

  const readme = await readFile(
    readmePath,
    'utf8',
  );

  await writeFile(
    readmePath,
    readme.replace(
      /^# .*$/m,
      `# ${titulo}`,
    ),
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
  const aliases = {
    monitoreo: 'monitoreo-base',
    base: 'base',
  };

  const v =
    aliases[valor.toLowerCase()] ??
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
      Nombre del módulo.
      Si no se indica, se propone el nombre
      de la carpeta destino.

  --plantilla <plantilla>
      Plantilla a utilizar:
      base | listado-base | listado-formulario | monitoreo

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

  printHeader();

  const {
    seed,
    temporal,
  } = await resolverSeed(
    args.origen,
  );

  try {
    const plantillas =
      await listarPlantillas(seed);

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
      seed,
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

    let nombre = args.nombre;

    if (!nombre) {
      const sugerido =
        normalizarSlug(
          path.basename(
            args.destino,
          ),
        ) ||
        NOMBRE_SUGERIDO;

      printSection(
        'Configuración del módulo',
      );

      nombre = await pedir(
        rl,
        `${chalk.hex(COLORS.secondary)(
          'Nombre del módulo',
        )} [${chalk.bold(sugerido)}]: `,
        validarNombre,
      );

      nombre ??= sugerido;
    }

    if (validarNombre(nombre)) {
      throw new Error(
        `Nombre inválido: ${nombre}`,
      );
    }

    let plantilla = args.plantilla
      ? normalizarPlantilla(
          args.plantilla,
          plantillas,
        )
      : null;

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

        const choices =
          plantillas.map(
            (p) => ({
              title: p,
              description:
                obtenerDescripcionPlantilla(
                  p,
                ),
              value: p,
            }),
          );

        try {
          const res =
            await prompts({
              type: 'select',
              name: 'plantilla',
              message:
                'Selecciona una plantilla',
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
            '\nPlantillas disponibles:',
          );

          plantillas.forEach(
            (p, i) => {
              console.log(
                `  ${chalk.hex(
                  COLORS.secondary,
                )(`[${i + 1}]`)} ${chalk.bold(
                  p,
                )}`,
              );

              console.log(
                `      ${chalk.hex(
                  COLORS.muted,
                )(
                  obtenerDescripcionPlantilla(
                    p,
                  ),
                )}`,
              );
            },
          );

          const elegida =
            await pedir(
              rl,
              `\nSelecciona una plantilla [1]: `,
              (v) =>
                normalizarPlantilla(
                  v,
                  plantillas,
                )
                  ? null
                  : `Disponibles: ${plantillas.join(', ')}`,
            );

          plantilla =
            normalizarPlantilla(
              elegida ?? '1',
              plantillas,
            );
        }
      } else {
        console.log(
          '\nPlantillas disponibles:',
        );

        plantillas.forEach(
          (p, i) => {
            console.log(
              `  ${chalk.hex(
                COLORS.secondary,
              )(`[${i + 1}]`)} ${chalk.bold(
                p,
              )}`,
            );

            console.log(
              `      ${chalk.hex(
                COLORS.muted,
              )(
                obtenerDescripcionPlantilla(
                  p,
                ),
              )}`,
            );
          },
        );

        const elegida =
          await pedir(
            rl,
            `\nSelecciona una plantilla [1]: `,
            (v) =>
              normalizarPlantilla(
                v,
                plantillas,
              )
                ? null
                : `Disponibles: ${plantillas.join(', ')}`,
          );

        plantilla =
          normalizarPlantilla(
            elegida ?? '1',
            plantillas,
          );
      }
    }

    // ----------------------------------------------------------------------
    // 3. Resumen y confirmación
    // ----------------------------------------------------------------------

    printSection(
      'Resumen',
    );

    printLabelValue(
      'Módulo',
      nombre,
    );

    printLabelValue(
      'Plantilla',
      plantilla,
    );

    printLabelValue(
      'Destino',
      args.destino,
    );

    printLabelValue(
      'Seed',
      `${seed}${
        temporal
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
          const res =
            await prompts({
              type: 'confirm',
              name: 'ok',
              message:
                '¿Crear este módulo?',
              initial: true,
            });

          confirmado = res.ok;
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
          seed,
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
      const sTpl = ora(
        `Aplicando plantilla '${plantilla}'...`,
      ).start();

      try {
        await aplicarPlantilla(
          args.destino,
          plantilla,
          path.join(
            seed,
            'src',
            'assets',
            'plantillas',
          ),
        );

        sTpl.succeed(
          `Plantilla '${plantilla}' aplicada`,
        );
      } catch (err) {
        sTpl.fail(
          `Error al aplicar plantilla '${plantilla}'`,
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

    // ----------------------------------------------------------------------
    // 7. Resultado final
    // ----------------------------------------------------------------------

    const lines = [
      chalk.hex(COLORS.success).bold(
        '✓ Módulo creado correctamente',
      ),
      '',
      chalk.bold(nombre),
      '',
      chalk.hex(COLORS.muted)(
        'Siguientes pasos',
      ),
      '',
      chalk.hex(COLORS.secondary)(
        `cd ${nombre}`,
      ),
      chalk.hex(COLORS.secondary)(
        'npm install',
      ),
      chalk.hex(COLORS.secondary)(
        'npm start',
      ),
      '',
      `${chalk.hex(COLORS.muted)(
        'Plantilla',
      )}  ${plantilla}`,
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
    } else {
      lines.push(
        '',
        chalk.hex(COLORS.muted)(
          `La plantilla '${plantilla}' se aplicó en src/app.`,
        ),
        chalk.hex(COLORS.muted)(
          'La carpeta de plantillas fue eliminada del proyecto generado.',
        ),
      );
    }

    console.log(
      boxen(
        lines.join('\n'),
        {
          padding: 1,
          margin: 1,
          borderStyle: 'round',
          borderColor:
            COLORS.primary,
        },
      ),
    );
  } finally {
    if (temporal) {
      await rm(seed, {
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