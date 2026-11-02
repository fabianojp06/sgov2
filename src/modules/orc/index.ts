// Entrada pública do orc (orçamento da Administração Central, UC04.17).
export { avancar, criar } from './application/acoes-exercicios';
export { listarExercicios, sugerirAno, type ResumoExercicio } from './application/exercicios';
export { FUNCIONALIDADES_ORC, seedOrc } from './infrastructure/seed';
export { FormExercicio } from './ui/form-exercicio';
export { ListaExercicios, textoAviso } from './ui/lista-exercicios';
export { SeletorExercicio, type OpcaoExercicio } from './ui/seletor-exercicio';
