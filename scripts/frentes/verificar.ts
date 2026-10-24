// Verificação de fronteira de frente (spec §12.3, §12.5 e §12.8).
// Uso: tsx scripts/frentes/verificar.ts --frente A --labels a,b < lista-de-arquivos
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import picomatch from 'picomatch';
import { parse } from 'yaml';

export type Frente = 'A' | 'B';

export type MapaFrentes = {
  frentes: Record<Frente, string[]>;
  compartilhados: string[];
  livres: string[];
  migrations: string[];
};

export type Violacao = {
  tipo: 'outra-frente' | 'compartilhado' | 'compartilhado-misturado' | 'migration-multipla';
  arquivo?: string;
};

export type EntradaVerificacao = {
  arquivos: string[];
  labels: string[];
  frente: Frente;
  mapa: MapaFrentes;
};

const LABEL_COMPARTILHADO = 'compartilhado';
const LABEL_TOCA_OUTRA_FRENTE = 'toca-outra-frente';
const MIGRATION = picomatch('prisma/migrations/*/migration.sql', { dot: true });

type Classe = 'livre' | 'migration' | 'compartilhado' | Frente;

function casador(globs: string[]): (arquivo: string) => boolean {
  return globs.length === 0 ? () => false : picomatch(globs, { dot: true });
}

function listaDeTexto(valor: unknown, campo: string): string[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) {
    throw new Error(`frentes.yml: o campo "${campo}" deve ser uma lista de globs.`);
  }
  return valor as string[];
}

export function lerMapaFrentes(caminho = '.github/frentes.yml'): MapaFrentes {
  const bruto = parse(readFileSync(caminho, 'utf8')) as Record<string, unknown> | null;
  const frentes = (bruto?.frentes ?? {}) as Record<string, unknown>;
  return {
    frentes: { A: listaDeTexto(frentes.A, 'frentes.A'), B: listaDeTexto(frentes.B, 'frentes.B') },
    compartilhados: listaDeTexto(bruto?.compartilhados, 'compartilhados'),
    livres: listaDeTexto(bruto?.livres, 'livres'),
    migrations: listaDeTexto(bruto?.migrations, 'migrations'),
  };
}

export function verificarFrentes({ arquivos, labels, frente, mapa }: EntradaVerificacao): Violacao[] {
  const ehLivre = casador(mapa.livres);
  const ehMigration = casador(mapa.migrations);
  const ehCompartilhado = casador(mapa.compartilhados);
  const ehDaFrente: Record<Frente, (a: string) => boolean> = {
    A: casador(mapa.frentes.A),
    B: casador(mapa.frentes.B),
  };
  const outra: Frente = frente === 'A' ? 'B' : 'A';

  const classificar = (arquivo: string): Classe => {
    if (ehLivre(arquivo)) return 'livre';
    if (ehMigration(arquivo)) return 'migration';
    if (ehCompartilhado(arquivo)) return 'compartilhado';
    if (ehDaFrente[frente](arquivo)) return frente;
    if (ehDaFrente[outra](arquivo)) return outra;
    return 'compartilhado';
  };

  const prCompartilhado = labels.includes(LABEL_COMPARTILHADO);
  const podeTocarOutra = labels.includes(LABEL_TOCA_OUTRA_FRENTE);
  const violacoes: Violacao[] = [];

  for (const arquivo of arquivos) {
    const classe = classificar(arquivo);
    if (classe === 'livre' || classe === 'migration') continue;
    if (classe === 'compartilhado') {
      if (!prCompartilhado) violacoes.push({ tipo: 'compartilhado', arquivo });
      continue;
    }
    // Código de funcionalidade (de uma das frentes).
    if (prCompartilhado) {
      violacoes.push({ tipo: 'compartilhado-misturado', arquivo });
    } else if (classe === outra && !podeTocarOutra) {
      violacoes.push({ tipo: 'outra-frente', arquivo });
    }
  }

  if (arquivos.filter((a) => MIGRATION(a)).length > 1) {
    violacoes.push({ tipo: 'migration-multipla' });
  }
  return violacoes;
}

const MENSAGENS: Record<Violacao['tipo'], string> = {
  'outra-frente': 'arquivo da outra frente sem a label "toca-outra-frente"',
  compartilhado: 'arquivo compartilhado sem a label "compartilhado"',
  'compartilhado-misturado': 'PR "compartilhado" também altera código de funcionalidade',
  'migration-multipla': 'mais de uma migration nova no mesmo PR',
};

function argumento(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const frente = argumento(args, '--frente');
  if (frente !== 'A' && frente !== 'B') {
    console.error('Uso: tsx scripts/frentes/verificar.ts --frente A|B [--labels a,b] [--mapa caminho] < arquivos');
    process.exit(2);
  }
  const labels = (argumento(args, '--labels') ?? '').split(',').map((l) => l.trim()).filter(Boolean);
  const mapa = lerMapaFrentes(argumento(args, '--mapa'));
  let entrada = '';
  for await (const pedaco of process.stdin) entrada += String(pedaco);
  const arquivos = entrada.split('\n').map((l) => l.trim()).filter(Boolean);

  const violacoes = verificarFrentes({ arquivos, labels, frente, mapa });
  if (violacoes.length === 0) {
    console.log(`Fronteira de frente: nenhuma violação (${arquivos.length} arquivo(s), frente ${frente}).`);
    return;
  }
  console.error(`Fronteira de frente: ${violacoes.length} violação(ões) (spec §12.3/§12.8):`);
  for (const v of violacoes) console.error(`- ${MENSAGENS[v.tipo]}${v.arquivo ? `: ${v.arquivo}` : ''}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
