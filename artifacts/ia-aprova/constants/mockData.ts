/** Legacy reference data kept for seed tooling only; production screens use the API. */
export const CONCURSOS = [
  { id: 'pf-agente', nome: 'Polícia Federal — Agente', sigla: 'PF' },
  { id: 'prf', nome: 'Polícia Rodoviária Federal', sigla: 'PRF' },
  { id: 'espc-ex', nome: 'EsPCEx', sigla: 'EsPCEx' },
  { id: 'fuzileiros', nome: 'Fuzileiros Navais', sigla: 'CFN' },
] as const;

export const MATERIAS = ['Português', 'Raciocínio Lógico', 'Informática', 'Direito Constitucional', 'Direito Administrativo', 'Contabilidade'] as const;
export const BANCAS = ['Cebraspe', 'FGV', 'Vunesp', 'Fundação Getulio Vargas'] as const;

export type MockContest = (typeof CONCURSOS)[number];
