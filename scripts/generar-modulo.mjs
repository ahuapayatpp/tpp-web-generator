#!/usr/bin/env node
// Generador de módulos TPP. Crea un proyecto Angular nuevo en --destino (default: cwd)
// a partir del seed tpp-web-base-ux y una plantilla elegida por el usuario.
//
// Uso:
//   node scripts/generar-modulo.mjs [--origen <ruta|url>] [--destino <ruta>]
//                                   [--nombre <nombre>] [--plantilla <plantilla>]
//                                   [--yes] [--force] [--help]
//
//   --origen     Ruta local o URL git del seed (default: clone de CodeCommit).
//   --destino    Carpeta donde se crea el proyecto (default: directorio actual).
//   --nombre     Nombre del módulo (slug). Si no se pasa, se pide en el wizard.
//   --plantilla  base | listado-base | listado-formulario | monitoreo.
//   --yes        No pedir confirmación (modo CI).
//   --force      Permitir generar en un destino no vacío.
//
// El CLI NUNCA modifica el proyecto seed: siempre crea un proyecto nuevo en destino.

import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as os from 'node:os';

const CODECOMMIT_SEED = 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/tpp-web-base-ux';
const NOMBRE_SUGERIDO = 'tpp-web-mi-modulo';

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------

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
      case '--origen': args.origen = argv[++i]; break;
      case '--destino': args.destino = argv[++i]; break;
      case '--nombre': args.nombre = argv[++i]; break;
      case '--plantilla': args.plantilla = argv[++i]; break;
      case '--yes': args.yes = true; break;
      case '--force': args.force = true; break;
      case '--help': args.help = true; break;
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
  const out = execFileSync('git', ['-C', seed, ...extra, '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function normalizarSlug(valor) {
  return valor.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
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
  const efectivo = origen ?? CODECOMMIT_SEED; // sin --origen → clona el seed por defecto
  if (esUrlGit(efectivo)) {
    const tmp = await mkdtemp();
    try {
      console.log(`Clonando seed desde ${efectivo}...`);
      execFileSync('git', ['clone', '--depth', '1', efectivo, tmp], { stdio: 'inherit' });
      return { seed: tmp, temporal: true };
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw new Error(`No se pudo clonar el seed desde ${efectivo}.`);
    }
  }

  const seed = path.resolve(efectivo);
  if (!existsSync(path.join(seed, '.git'))) {
    throw new Error(
      `El directorio '${seed}' no es un repositorio git. Usa --origen con una ruta local o URL.`,
    );
  }
  try {
    execFileSync('git', ['-C', seed, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
  } catch {
    throw new Error(`El directorio '${seed}' no es un repositorio git.`);
  }
  return { seed, temporal: false };
}

async function mkdtemp() {
  const base = path.join(os.tmpdir(), 'tpp-generador-');
  return await (await import('node:fs/promises')).mkdtemp(base);
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
    if (rel.endsWith('/') || !existsSync(srcPath)) continue; // directorios o archivos borrados
    const destPath = path.join(destino, rel);
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    copiados++;
  }
  console.log(`Copiados ${copiados} archivos del seed.`);
}

// --------------------------------------------------------------------------
// Plantillas
// --------------------------------------------------------------------------

async function listarPlantillas(seed) {
  const plantillasDir = path.join(seed, 'src', 'assets', 'plantillas');
  const items = await readdir(plantillasDir, { withFileTypes: true }).catch(() => []);
  const carpetas = items
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((nombre) =>
      existsSync(path.join(plantillasDir, nombre, `${nombre}.routes.ts`)),
    );
  return ['base', ...carpetas];
}

async function aplicarPlantilla(destino, plantillaNombre, plantillasDir) {
  const app = path.join(destino, 'src', 'app');
  const plantillaDir = path.join(plantillasDir, plantillaNombre);

  for (const sub of ['components', 'pages']) {
    const src = path.join(plantillaDir, sub);
    if (existsSync(src)) {
      await cp(src, path.join(app, sub), { recursive: true, force: true });
    }
  }
  const core = path.join(plantillaDir, 'core');
  if (existsSync(core)) {
    await cp(core, path.join(app, 'core'), { recursive: true, force: true });
  }

  const rutasArchivo = (await readdir(plantillaDir)).find((f) => f.endsWith('.routes.ts'));
  if (!rutasArchivo) {
    throw new Error(`La plantilla '${plantillaNombre}' no tiene archivo de rutas (*.routes.ts).`);
  }
  await copyFile(path.join(plantillaDir, rutasArchivo), path.join(app, 'app.routes.ts'));

  // Limpiar contenido base puro (páginas y modelos del módulo base).
  await rm(path.join(app, 'pages', 'inicio'), { recursive: true, force: true });
  await rm(path.join(app, 'core', 'models', 'base.models.ts'), { force: true });

  // La carpeta plantillas es material del generador: se elimina del proyecto generado.
  await rm(path.join(destino, 'src', 'assets', 'plantillas'), { recursive: true, force: true });
}

// --------------------------------------------------------------------------
// Identidad del proyecto
// --------------------------------------------------------------------------

async function parametrizarIdentidad(destino, nombre) {
  const titulo = humanizar(nombre);

  const pkgPath = path.join(destino, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.name = nombre;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const angPath = path.join(destino, 'angular.json');
  const ang = JSON.parse(await readFile(angPath, 'utf8'));
  if (ang.projects && ang.projects['tpp-base']) {
    const proyecto = ang.projects['tpp-base'];
    delete ang.projects['tpp-base'];
    ang.projects[nombre] = proyecto;
    if (proyecto.architect?.build?.options?.outputPath) {
      proyecto.architect.build.options.outputPath = `dist/${nombre}`;
    }
    for (const conf of Object.values(proyecto.architect?.serve?.configurations ?? {})) {
      if (conf?.buildTarget) {
        conf.buildTarget = conf.buildTarget.replace(/^tpp-base/, nombre);
      }
    }
  }
  await writeFile(angPath, JSON.stringify(ang, null, 2) + '\n', 'utf8');

  const idxPath = path.join(destino, 'src', 'index.html');
  const idx = await readFile(idxPath, 'utf8');
  await writeFile(idxPath, idx.replace(/<title>[^<]*<\/title>/i, `<title>${titulo}</title>`), 'utf8');

  const readmePath = path.join(destino, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  await writeFile(readmePath, readme.replace(/^# .*$/m, `# ${titulo}`), 'utf8');

  console.log(`Identidad del proyecto actualizada: ${nombre} (${titulo}).`);
}

// --------------------------------------------------------------------------
// Wizard
// --------------------------------------------------------------------------

async function pedir(rl, pregunta, validar) {
  for (let i = 0; i < 5; i++) {
    const respuesta = (await rl.question(pregunta)).trim();
    if (!respuesta) return null;
    const error = validar ? validar(respuesta) : null;
    if (!error) return respuesta;
    console.log(`  ${error}`);
  }
  throw new Error('Demasiados intentos fallidos.');
}

function validarNombre(nombre) {
  return /^[a-z][a-z0-9_-]*$/.test(nombre)
    ? null
    : 'Solo minúsculas, números, guiones y guiones bajos; debe empezar por letra.';
}

function normalizarPlantilla(valor, plantillas) {
  const aliases = { monitoreo: 'monitoreo-base', base: 'base' };
  const v = aliases[valor.toLowerCase()] ?? valor.toLowerCase();
  const porNumero = /^[0-9]+$/.test(v);
  if (porNumero) {
    const idx = parseInt(v, 10);
    if (idx >= 1 && idx <= plantillas.length) return plantillas[idx - 1];
    return null;
  }
  return plantillas.includes(v) ? v : null;
}

// --------------------------------------------------------------------------
// Validaciones del destino
// --------------------------------------------------------------------------

const DESTINO_PERMITIDO = new Set(['.git', '.gitignore', 'README.md', 'README']);

async function validarDestino(destino, seed, force) {
  if (path.resolve(destino) === path.resolve(seed)) {
    throw new Error(
      'El destino es el propio seed (tpp-web-base-ux). El generador nunca modifica el seed; ' +
        'ejecútalo en el repo vacío del nuevo módulo o usa --destino.',
    );
  }
  if (force) return;
  const items = await readdir(destino, { withFileTypes: true }).catch(() => []);
  const bloqueantes = items.filter((i) => !DESTINO_PERMITIDO.has(i.name));
  if (bloqueantes.length > 0) {
    const nombres = bloqueantes.slice(0, 8).map((i) => i.name).join(', ');
    throw new Error(
      `El destino '${destino}' no está vacío (${nombres}${bloqueantes.length > 8 ? ', ...' : ''}). ` +
        'Usa --force si estás seguro.',
    );
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
Generador de módulos TPP (Phase 1). Crea un proyecto Angular nuevo en el destino a partir
del seed tpp-web-base-ux y una plantilla elegida por el usuario.

Uso:
  node scripts/generar-modulo.mjs [--origen <ruta|url>] [--destino <ruta>]
                                  [--nombre <nombre>] [--plantilla <plantilla>]
                                  [--yes] [--force] [--help]

  --origen     Ruta local o URL git del seed (default: clone de CodeCommit).
  --destino    Carpeta donde se crea el proyecto (default: directorio actual).
  --nombre     Nombre del módulo (slug). Si no se pasa, se pide en el wizard.
  --plantilla  base | listado-base | listado-formulario | monitoreo.
  --yes        No pedir confirmación (modo CI).
  --force      Permitir generar en un destino no vacío.

El CLI NUNCA modifica el proyecto seed: siempre crea un proyecto nuevo en destino.
`);
    return;
  }

  // 1. Resolver seed
  const { seed, temporal } = await resolverSeed(args.origen);
  try {
    const plantillas = await listarPlantillas(seed);
    if (plantillas.length === 0) {
      throw new Error('No se encontraron plantillas en el seed (src/assets/plantillas).');
    }

    // 2. Validar destino
    await validarDestino(args.destino, seed, args.force);

    // 3. Wizard interactivo
    const rl = readline.createInterface({ input: stdin, output: stdout });

    let nombre = args.nombre;
    if (!nombre) {
      const sugerido = normalizarSlug(path.basename(args.destino));
      nombre =
        (await pedir(
          rl,
          `Nombre del módulo [${sugerido || NOMBRE_SUGERIDO}]: `,
          validarNombre,
        )) ?? (sugerido || NOMBRE_SUGERIDO);
    }
    if (validarNombre(nombre)) {
      throw new Error(`Nombre inválido: ${nombre}`);
    }

    let plantilla = args.plantilla ? normalizarPlantilla(args.plantilla, plantillas) : null;
    if (!plantilla) {
      if (args.plantilla) {
        throw new Error(
          `Plantilla desconocida: '${args.plantilla}'. Disponibles: ${plantillas.join(', ')}.`,
        );
      }
      console.log('\nPlantillas disponibles:');
      plantillas.forEach((p, i) => {
        const nota =
          p === 'base'
            ? ' (estado por defecto del proyecto; conserva src/assets/plantillas)'
            : '';
        console.log(`  [${i + 1}] ${p}${nota}`);
      });
      const elegida = await pedir(rl, `\nSelecciona una plantilla [1]: `, (v) =>
        normalizarPlantilla(v, plantillas) ? null : `Disponibles: ${plantillas.join(', ')}`,
      );
      plantilla = normalizarPlantilla(elegida ?? '1', plantillas);
    }

    // 4. Resumen y confirmación
    console.log('\nResumen de la generación:');
    console.log(`  Nombre del módulo : ${nombre}`);
    console.log(`  Plantilla         : ${plantilla}`);
    console.log(`  Destino           : ${args.destino}`);
    console.log(`  Seed              : ${seed}${temporal ? ' (clone temporal)' : ''}`);

    if (!args.yes) {
      const confirmacion = await pedir(rl, '\n¿Crear el módulo? (s/N): ', (v) =>
        ['s', 'S', 'n', 'N', 'y', 'Y', ''].includes(v) ? null : 'Responde s o n.',
      );
      if (!confirmacion || /^n$/i.test(confirmacion)) {
        console.log('Generación cancelada.');
        return;
      }
    }
    rl.close();

    // 5. Copiar proyecto
    console.log('\nCopiando proyecto...');
    await copiarProyecto(seed, args.destino);

    // 6. Aplicar plantilla
    if (plantilla !== 'base') {
      console.log(`Aplicando plantilla '${plantilla}'...`);
      await aplicarPlantilla(args.destino, plantilla, path.join(seed, 'src', 'assets', 'plantillas'));
    }

    // 7. Parametrizar identidad
    await parametrizarIdentidad(args.destino, nombre);

    // 8. Mensaje final
    console.log('\n✔ Módulo creado correctamente.');
    console.log('Siguientes pasos:');
    console.log(`  cd ${args.destino}`);
    console.log('  npm install');
    console.log('  npm start');
    if (plantilla === 'base') {
      console.log(
        '\nConsejo: puedes pedirle a la IA crear un módulo nuevo usando como referencia\n' +
          '  src/assets/plantillas/, AGENTS.md y especificaciones-ui/.',
      );
    } else {
      console.log(
        `\nLa plantilla '${plantilla}' se aplicó en src/app. ` +
          'La carpeta src/assets/plantillas/ fue eliminada del proyecto generado.',
      );
    }
  } finally {
    if (temporal) {
      await rm(seed, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(`\n[Error] ${err.message}`);
  process.exitCode = 1;
});