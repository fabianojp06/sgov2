import { explicarDesvioAcao, iaLiberada, naoEncontradoSeNegado, obterOrcadoRealizado, TelaOxr } from '@/modules/orc';
import { exigirPagina } from '@/shared/authz';

// Orçado x Realizado do TP (US-086, parte 1; OxR V2, seção 5): só leitura, para quem tem orc.oxr. Os filtros vêm da
// URL (?proposta, ?de, ?ate, ?conta, ?zeradas=sim|nao); sem ?proposta, só o formulário.
type Busca = Partial<Record<'proposta' | 'de' | 'ate' | 'conta' | 'zeradas', string | string[]>>;
const um = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function OrcadoRealizado({ searchParams }: { searchParams: Promise<Busca> }) {
  const ctx = await exigirPagina('orc.oxr', 'consultar');
  const b = await searchParams;
  const [dados, comIa] = await Promise.all([
    obterOrcadoRealizado(ctx, { proposta: um(b.proposta), de: um(b.de), ate: um(b.ate), conta: um(b.conta), zeradas: um(b.zeradas) === 'sim' }).catch(naoEncontradoSeNegado(ctx)),
    iaLiberada(ctx, 'desvio'),
  ]);
  return (
    <div>
      <h1>Orçado x Realizado</h1>
      <TelaOxr
        dados={dados}
        podeAtualizar={ctx.permissoes.has('orc.realizado:executar')}
        podeVerRealizado={ctx.permissoes.has('orc.realizado:consultar')}
        podeExportar={ctx.permissoes.has('orc.oxr:exportar')}
        ia={comIa ? explicarDesvioAcao : null}
      />
    </div>
  );
}
