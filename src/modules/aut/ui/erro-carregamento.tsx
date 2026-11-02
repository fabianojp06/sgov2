'use client';

import { BotaoSair } from './botao-sair';

export const MENSAGENS_CARREGAMENTO = {
  modulos: 'Não foi possível carregar os módulos do sistema. Tente novamente ou contate o Administrador.',
  permissoes: 'Não foi possível carregar suas permissões de acesso. Tente novamente ou contate o Administrador.',
} as const;

// Falha ao montar a tela principal (UC01.03 E1/E2): tentar de novo ou sair (E1.3/E2.3).
export function ErroCarregamento({ tipo }: { tipo: keyof typeof MENSAGENS_CARREGAMENTO }) {
  return (
    <main role="alert">
      <p>{MENSAGENS_CARREGAMENTO[tipo]}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Tentar novamente
      </button>
      <BotaoSair />
    </main>
  );
}
