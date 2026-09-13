/**
 * Seed de dados de referência: concursos, matérias, bancas.
 *
 * Fonte: a lista real já usada pelo app mobile em
 * `artifacts/ia-aprova/constants/mockData.ts` (CONCURSOS/MATERIAS/BANCAS),
 * para não inventar dados que divergem do que a UI já mostra.
 *
 * Uso: pnpm --filter @workspace/db run seed
 */
import { db, pool } from "../index";
import { concursosTable, materiasTable, bancasTable } from "../schema";

const ACCENTED_CHARS: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n",
};

function removeAccents(value: string): string {
  return value
    .split("")
    .map((char) => ACCENTED_CHARS[char.toLowerCase()] ?? char)
    .join("");
}

function slugify(value: string): string {
  return removeAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CONCURSOS = [
  // Militares
  { id: "esa", nome: "ESA", instituicao: "Escola de Sargentos das Armas", categoria: "militares" },
  { id: "eear", nome: "EEAR", instituicao: "Escola de Especialistas da Aeronáutica", categoria: "militares" },
  { id: "espcex", nome: "EsPCEx", instituicao: "Escola Preparatória de Cadetes", categoria: "militares" },
  { id: "afa", nome: "AFA", instituicao: "Academia da Força Aérea", categoria: "militares" },
  { id: "naval", nome: "Escola Naval", instituicao: "Escola Naval", categoria: "militares" },
  { id: "efomm", nome: "EFOMM", instituicao: "Escola de Formação de Oficiais da Marinha Mercante", categoria: "militares" },
  { id: "eam", nome: "EAM", instituicao: "Escola de Aprendizes-Marinheiros", categoria: "militares" },
  // Policiais
  { id: "pf", nome: "PF", instituicao: "Polícia Federal", categoria: "policiais" },
  { id: "prf", nome: "PRF", instituicao: "Polícia Rodoviária Federal", categoria: "policiais" },
  { id: "pcivil", nome: "Polícia Civil", instituicao: "Polícia Civil", categoria: "policiais" },
  { id: "ppenal", nome: "Polícia Penal", instituicao: "Polícia Penal", categoria: "policiais" },
  { id: "pmsp", nome: "PM-SP", instituicao: "Polícia Militar de São Paulo", categoria: "policiais" },
  { id: "pmrj", nome: "PM-RJ", instituicao: "Polícia Militar do Rio de Janeiro", categoria: "policiais" },
  // Bancários
  { id: "bb", nome: "Banco do Brasil", instituicao: "Banco do Brasil", categoria: "bancarios" },
  { id: "cef", nome: "Caixa", instituicao: "Caixa Econômica Federal", categoria: "bancarios" },
  { id: "bacen", nome: "Banco Central", instituicao: "Banco Central do Brasil", categoria: "bancarios" },
  { id: "bndes", nome: "BNDES", instituicao: "Banco Nacional de Desenvolvimento", categoria: "bancarios" },
  // Fiscais
  { id: "rfb", nome: "Receita Federal", instituicao: "Receita Federal do Brasil", categoria: "fiscais" },
  { id: "sefaz", nome: "SEFAZ", instituicao: "Secretaria da Fazenda Estadual", categoria: "fiscais" },
  { id: "iss", nome: "ISS", instituicao: "Imposto Sobre Serviços (Municipal)", categoria: "fiscais" },
  // Tribunais
  { id: "tjsp", nome: "TJ-SP", instituicao: "Tribunal de Justiça de SP", categoria: "tribunais" },
  { id: "trt", nome: "TRT", instituicao: "Tribunal Regional do Trabalho", categoria: "tribunais" },
  { id: "tre", nome: "TRE", instituicao: "Tribunal Regional Eleitoral", categoria: "tribunais" },
  { id: "trf", nome: "TRF", instituicao: "Tribunal Regional Federal", categoria: "tribunais" },
  // Administrativos
  { id: "inss", nome: "INSS", instituicao: "Instituto Nacional do Seguro Social", categoria: "administrativos" },
  { id: "correios", nome: "Correios", instituicao: "Empresa Brasileira de Correios", categoria: "administrativos" },
  { id: "ibge", nome: "IBGE", instituicao: "Instituto Brasileiro de Geografia e Estatística", categoria: "administrativos" },
  // Saúde
  { id: "ebserh", nome: "EBSERH", instituicao: "Empresa Brasileira de Serviços Hospitalares", categoria: "saude" },
  { id: "sus", nome: "SUS", instituicao: "Sistema Único de Saúde", categoria: "saude" },
] as const;

const MATERIAS = [
  "Direito Constitucional",
  "Direito Administrativo",
  "Direito Penal",
  "Língua Portuguesa",
  "Matemática",
  "Raciocínio Lógico",
  "Atualidades",
  "Informática",
  "Física",
  "Química",
  "Biologia",
  "História",
  "Geografia",
];

// A lista em mockData.ts só tem o nome/sigla da banca (sem razão social completa).
// Uso o mesmo valor para nome e sigla até termos o dado completo de cada banca.
const BANCAS = [
  "CESPE/CEBRASPE",
  "FCC",
  "Vunesp",
  "FGV",
  "IDECAN",
  "AOCP",
  "IBFC",
  "Quadrix",
  "CEFET",
  "ESA Interna",
];

async function seedConcursos() {
  const rows = CONCURSOS.map((c) => ({
    id: c.id,
    nome: c.nome,
    categoria: c.categoria,
    instituicao: c.instituicao,
    ativo: true,
  }));
  await db.insert(concursosTable).values(rows).onConflictDoNothing({ target: concursosTable.id });
  return rows.length;
}

async function seedMaterias() {
  const rows = MATERIAS.map((nome) => ({
    id: slugify(nome),
    nome,
    slug: slugify(nome),
  }));
  await db.insert(materiasTable).values(rows).onConflictDoNothing({ target: materiasTable.id });
  return rows.length;
}

async function seedBancas() {
  const rows = BANCAS.map((nome) => ({
    id: slugify(nome),
    nome,
    sigla: nome,
  }));
  await db.insert(bancasTable).values(rows).onConflictDoNothing({ target: bancasTable.id });
  return rows.length;
}

async function main() {
  console.log("Iniciando seed de dados de referência...");

  const concursos = await seedConcursos();
  console.log(`  ${concursos} concursos`);

  const materias = await seedMaterias();
  console.log(`  ${materias} materias`);

  const bancas = await seedBancas();
  console.log(`  ${bancas} bancas`);

  console.log("Seed de dados de referência completo.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
