// Entrada pública do orc (orçamento da Administração Central, UC04.17).
export { avancar, criar } from './application/acoes-exercicios';
export { alterarReceitaAcao, excluirReceitaAcao, incluirReceitaAcao } from './application/acoes-receitas';
export { listarExercicios, sugerirAno, type ResumoExercicio } from './application/exercicios';
export { listarReceitas, obterReceita, type ListaReceitas as DadosReceitas } from './application/receitas';
export { FUNCIONALIDADES_ORC, seedOrc } from './infrastructure/seed';
export { FormReceita, type ReceitaFormulario } from './ui/form-receita';
export { FormExercicio } from './ui/form-exercicio';
export { ListaExercicios, textoAviso } from './ui/lista-exercicios';
export { ListaReceitas, SELO_TRANSICAO, textoAvisoReceita } from './ui/lista-receitas';
export { exercicioDoAno, naoEncontradoSeNegado } from './ui/pagina';
export { SeletorExercicio, type OpcaoExercicio } from './ui/seletor-exercicio';
