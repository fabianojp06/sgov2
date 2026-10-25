import type { TxCliente } from '@/shared/db';
import { auditarSeed } from './auditar-seed';
import { validarDeclaracoes, type DeclaracaoFuncionalidade } from './catalogo';

const CAMPOS_DESCRITIVOS = ['moduloCodigo', 'grupo', 'nome', 'rota', 'ordem', 'ajuda', 'nivelLog'] as const;

// Instala as funcionalidades declaradas por um módulo (contrato C6). Idempotente e sem desfazer o
// Administrador (RN_SEED_002): numa funcionalidade existente só os campos descritivos mudam, nunca
// o `ativo`; cada permissão padrão é concedida uma vez só (tabela permissao_padrao_aplicada).
export async function instalarFuncionalidades(
  tx: TxCliente,
  itens: readonly DeclaracaoFuncionalidade[],
): Promise<{ criadas: number }> {
  validarDeclaracoes(itens);
  let criadas = 0;
  for (const item of itens) {
    const dados = {
      moduloCodigo: item.modulo,
      grupo: item.grupo,
      nome: item.nome,
      rota: item.rota,
      ordem: item.ordem,
      ajuda: item.ajuda ?? null,
      nivelLog: item.nivelLog ?? 'SIMPLES',
      acoes: [...item.acoes],
    };
    const atual = await tx.funcionalidade.findUnique({ where: { codigo: item.codigo } });
    if (!atual) {
      await tx.funcionalidade.create({ data: { codigo: item.codigo, ...dados } });
      await auditarSeed(tx, `Seed: funcionalidade ${item.codigo} instalada`, item.codigo);
      criadas++;
    } else {
      const mudou =
        CAMPOS_DESCRITIVOS.some((c) => atual[c] !== dados[c]) || atual.acoes.join(',') !== dados.acoes.join(',');
      if (mudou) {
        await tx.funcionalidade.update({ where: { codigo: item.codigo }, data: dados });
        await auditarSeed(tx, `Seed: funcionalidade ${item.codigo} atualizada`, item.codigo);
      }
    }
    await aplicarPadroes(tx, item);
  }
  return { criadas };
}

async function aplicarPadroes(tx: TxCliente, item: DeclaracaoFuncionalidade): Promise<void> {
  for (const [perfilCodigo, acoes] of Object.entries(item.perfisPadrao)) {
    const perfil = await tx.perfil.findUnique({ where: { codigo: perfilCodigo } });
    // Perfil ainda não instalado: o padrão fica para a seed em que ele já existir.
    if (!perfil) continue;
    for (const acao of acoes ?? []) {
      const chave = { perfilCodigo, funcionalidadeCodigo: item.codigo, acao };
      const aplicada = await tx.permissaoPadraoAplicada.findUnique({ where: { perfilCodigo_funcionalidadeCodigo_acao: chave } });
      if (aplicada) continue;
      await tx.$executeRaw`
        INSERT INTO perfil_permissao (perfil_id, funcionalidade_codigo, acao)
        VALUES (${perfil.id}::uuid, ${item.codigo}, ${acao}) ON CONFLICT DO NOTHING`;
      await tx.permissaoPadraoAplicada.create({ data: chave });
      await auditarSeed(tx, `Seed: permissão padrão ${item.codigo}:${acao} concedida ao perfil ${perfilCodigo}`, item.codigo);
    }
  }
}
