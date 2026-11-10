import type { VersaoModelo } from './tipos';

// Versão publicada: imutável (o hash deste arquivo está em modelos-versoes.test.ts). Para mudar o
// texto, crie a v2 e aponte VERSAO_ATUAL para ela. Sem o prazo de disponibilidade no texto: ele é
// provisório e mudaria a versão.
export const exportacaoConcluidaV1: VersaoModelo<'exportacao.concluida'> = {
  assunto: () => '[SGO 2.0][Exportação] Sua exportação terminou',
  corpo: (d) =>
    d.resultado === 'pronta'
      ? [
          { tipo: 'texto', texto: `Olá, ${d.nome}.` },
          { tipo: 'texto', texto: `A exportação "${d.titulo}" que você pediu está pronta.` },
          { tipo: 'link', texto: 'Baixar em Minhas exportações', url: d.urlAcesso },
        ]
      : [
          { tipo: 'texto', texto: `Olá, ${d.nome}.` },
          { tipo: 'texto', texto: `A exportação "${d.titulo}" que você pediu não pôde ser gerada.` },
          { tipo: 'texto', texto: 'O motivo está em Minhas exportações. Se precisar, peça a exportação de novo.' },
          { tipo: 'link', texto: 'Abrir Minhas exportações', url: d.urlAcesso },
        ],
};
