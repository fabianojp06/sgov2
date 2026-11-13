import type { ReactNode } from 'react';
import type { ErroCampo } from '@/shared/kernel';
import type { MenuModulo } from '../application/menu';
import { Ajuda } from './ajuda';
import { BotaoSair } from './botao-sair';
import { MenuLateral } from './menu-lateral';
import { SeletorUnidade } from './seletor-unidade';

const NOME_SISTEMA = 'SGO 2.0 – Sistema de Gestão Orçamentária';
const MENU_VAZIO = 'Nenhuma funcionalidade disponível para o seu perfil de acesso. Contate o Administrador.';

type Props = {
  menu: readonly MenuModulo[];
  unidades: readonly { id: string; codigo: string; nome: string }[];
  unidadeAtiva: string | null;
  usuario: { nome: string; acessoEm: string };
  trocarUnidade: (d: { unidadeId: string }) => Promise<{ ok: true } | { ok: false; status?: number; erros: readonly ErroCampo[] }>;
  children?: ReactNode;
};

const formatarAcesso = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

// Tela principal (UC01.03): cabeçalho com o sistema e o TP, menu lateral por permissão e barra de
// status com o usuário, a data e a hora do acesso, Ajuda, Alterar senha e Sair (REQ0046). Marca
// neutra (spec §6.7). Server Component: as partes interativas são componentes cliente.
export function TelaPrincipal({ menu, unidades, unidadeAtiva, usuario, trocarUnidade, children }: Props) {
  return (
    <div className="sgo-tela">
      <header className="sgo-cabecalho">
        <span className="sgo-sistema">{NOME_SISTEMA}</span>
        <SeletorUnidade unidades={unidades} unidadeAtiva={unidadeAtiva} trocar={trocarUnidade} />
      </header>
      <div className="sgo-corpo">
        {menu.length > 0 ? <MenuLateral menu={menu} /> : null}
        <main className="sgo-conteudo">
          {menu.length === 0 ? <p role="status">{MENU_VAZIO}</p> : null}
          {children}
        </main>
      </div>
      <footer className="sgo-status">
        <span>{usuario.nome}</span>
        <span>Acesso em {formatarAcesso(usuario.acessoEm)}</span>
        <Ajuda menu={menu} />
        <a href="/troca-senha">Alterar senha</a>
        <BotaoSair />
      </footer>
      <style>{`
        body { margin: 0; }
        .sgo-tela { height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; font-family: system-ui, sans-serif; }
        .sgo-cabecalho { background: #1F3864; color: #fff; display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; }
        .sgo-corpo { flex: 1; display: flex; min-height: 0; }
        .sgo-menu { width: 280px; background: #f3f6fa; border-right: 3px solid #2E75B6; padding: 12px; overflow-y: auto; }
        .sgo-menu h2 { color: #1F3864; font-size: 1rem; margin: 12px 0 4px; }
        .sgo-menu h3 { color: #2E75B6; font-size: .9rem; margin: 8px 0 2px; }
        .sgo-menu ul { margin: 0; padding-left: 16px; }
        .sgo-menu li { margin: 2px 0; }
        .sgo-conteudo { flex: 1; padding: 16px; overflow-y: auto; min-width: 0; }
        .sgo-status { background: #2E75B6; color: #fff; display: flex; gap: 16px; align-items: center; padding: 6px 16px; }
        .sgo-status a { color: #fff; }
      `}</style>
    </div>
  );
}
