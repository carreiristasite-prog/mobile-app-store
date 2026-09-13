/**
 * Creates the approved 19-family catalog in DRAFT state. Publication is a
 * separate editorial gate; this seed intentionally cannot make empty tracks
 * visible to students.
 */
import { db, examVersionsTable, pool, productsTable, subjectsTable } from "../index";

const products = [
  ["esa", "ESA", "Escola de Sargentos das Armas", "military", null],
  ["espcex", "EsPCEx", "Escola Preparatória de Cadetes do Exército", "military", null],
  ["eear", "EEAR", "Escola de Especialistas de Aeronáutica", "military", null],
  ["colegio-naval", "Colégio Naval", "Marinha do Brasil", "military", null],
  ["fuzileiro-naval", "Soldado Fuzileiro Naval", "Marinha do Brasil", "military", null],
  ["pm-sp", "PM-SP", "Polícia Militar do Estado de São Paulo", "police", null],
  ["pmerj", "PMERJ", "Polícia Militar do Estado do Rio de Janeiro", "police", null],
  ["pf", "Polícia Federal", "Polícia Federal", "police", "Agente"],
  ["prf", "PRF", "Polícia Rodoviária Federal", "police", "Policial Rodoviário Federal"],
  ["banco-do-brasil", "Banco do Brasil", "Banco do Brasil", "banking", "Agente Comercial"],
  ["caixa", "Caixa", "Caixa Econômica Federal", "banking", "Técnico Bancário"],
  ["correios", "Correios", "Empresa Brasileira de Correios e Telégrafos", "administrative", "Carteiro"],
  ["inss", "INSS", "Instituto Nacional do Seguro Social", "administrative", "Técnico"],
  ["enem", "ENEM", "Instituto Nacional de Estudos e Pesquisas Educacionais", "education", null],
  ["uerj", "UERJ", "Universidade do Estado do Rio de Janeiro", "education", null],
  ["cnu", "CNU", "Ministério da Gestão e da Inovação", "administrative", null],
  ["tse-tre", "TSE/TRE", "Justiça Eleitoral", "court", "Técnico Administrativo"],
  ["tj-sp", "TJ-SP", "Tribunal de Justiça do Estado de São Paulo", "court", "Escrevente"],
  ["rfb-auditor", "Receita Federal", "Receita Federal do Brasil", "tax", "Auditor-Fiscal"],
] as const;

const subjects = [
  ["portuguese", "lingua-portuguesa", "Língua Portuguesa"],
  ["mathematics", "matematica", "Matemática"],
  ["logical-reasoning", "raciocinio-logico", "Raciocínio Lógico"],
  ["computing", "informatica", "Informática"],
  ["current-affairs", "atualidades", "Atualidades"],
  ["constitutional-law", "direito-constitucional", "Direito Constitucional"],
  ["administrative-law", "direito-administrativo", "Direito Administrativo"],
  ["criminal-law", "direito-penal", "Direito Penal"],
  ["physics", "fisica", "Física"],
  ["chemistry", "quimica", "Química"],
  ["biology", "biologia", "Biologia"],
  ["history", "historia", "História"],
  ["geography", "geografia", "Geografia"],
  ["english", "ingles", "Inglês"],
] as const;

async function main() {
  await db.insert(productsTable).values(products.map(([id, name, institution, category, defaultTrack]) => ({
    id,
    slug: id,
    name,
    institution,
    category,
    defaultTrack,
    status: "draft",
  }))).onConflictDoNothing();
  await db.insert(subjectsTable).values(subjects.map(([id, slug, name]) => ({ id, slug, name }))).onConflictDoNothing();
  await db.insert(examVersionsTable).values(products.map(([id, _name, _institution, _category, defaultTrack]) => ({
    productId: id,
    code: "initial-draft",
    role: defaultTrack,
    status: "draft",
  }))).onConflictDoNothing();
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
