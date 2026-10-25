import type { TxCliente } from '@/shared/db';
import { auditarSeed } from './auditar-seed';
import { ErroDominio } from '@/shared/kernel';
import { MODULO_EXCLUSIVO_ADMIN, validarDeclaracoes, type DeclaracaoFuncionalidade } from './catalogo';

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
      // Uma funcionalidade que passa para o módulo de Administração não pode levar permissões de
      // outros perfis junto (RN_SEED_003).
      if (dados.moduloCodigo === MODULO_EXCLUSIVO_ADMIN && atual.moduloCodigo !== MODULO_EXCLUSIVO_ADMIN) {
        const outros = await tx.perfilPermissao.count({
          where: { funcionalidadeCodigo: item.codigo, perfil: { codigo: { not: 'ADMINISTRADOR' } } },
        });
        if (outros > 0) {
          throw new ErroDominio('seed.perfil_proibido', `${item.codigo} tem permissões de outros perfis e não pode ir para a Administração`);
        }
      }
      if (mudou) {
        await tx.funcionalidade.update({ where: { codigo: item.codigo }, data: dados });
        await auditarSeed(tx, `Seed: funcionalidade ${item.codigo} atualizada`, item.codigo);
      }
    }
    await aplicarPadroes(tx, item);
  }
  return { criadas };
}

// Cada padrão (perfil, funcionalidade, ação) é aplicado uma vez só (R12, com o ruling da
// revisão): um padrão novo só vai para o perfil que ainda tem acesso à funcionalidade ou que nunca
// recebeu padrão nela (perfil novo). O que o Administrador tirou por inteiro não volta ao menu.
async function aplicarPadroes(tx: TxCliente, item: DeclaracaoFuncionalidade): Promise<void> {
  for (const [perfilCodigo, acoes] of Object.entries(item.perfisPadrao)) {
    const perfil = await tx.perfil.findUnique({ where: { codigo: perfilCodigo } });
    // Perfil ainda não instalado: o padrão fica para a seed em que ele já existir.
    if (!perfil) continue;
    const jaAplicadas = await tx.permissaoPadraoAplicada.findMany({
      where: { perfilCodigo, funcionalidadeCodigo: item.codigo },
    });
    const pendentes = (acoes ?? []).filter((a) => !jaAplicadas.some((j) => j.acao === a));
    if (pendentes.length === 0) continue;
    const temAcesso = (await tx.perfilPermissao.count({ where: { perfilId: perfil.id, funcionalidadeCodigo: item.codigo } })) > 0;
    const conceder = jaAplicadas.length === 0 || temAcesso;
    for (const acao of pendentes) {
      if (conceder) {
        const inseridas = await tx.$executeRaw`
          INSERT INTO perfil_permissao (perfil_id, funcionalidade_codigo, acao)
          VALUES (${perfil.id}::uuid, ${item.codigo}, ${acao}) ON CONFLICT DO NOTHING`;
        if (inseridas === 1) {
          await auditarSeed(tx, `Seed: permissão padrão ${item.codigo}:${acao} concedida ao perfil ${perfilCodigo}`, item.codigo);
        }
      }
      await tx.permissaoPadraoAplicada.create({ data: { perfilCodigo, funcionalidadeCodigo: item.codigo, acao } });
    }
  }
}
