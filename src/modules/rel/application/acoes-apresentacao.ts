'use server';

import { z } from 'zod';
import { definirAcao } from '@/shared/authz';
import { exportarSlides, gerarRoteiro } from './apresentacao';

// Ações do roteiro de apresentação (US-105). A guarda confere a permissão; a entrada é validada no caso de
// uso (o roteiro, de forma estrita). Gerar chama a IA (tempo limite de 90 s no caso de uso).
const entrada = z.record(z.string(), z.unknown());

export const gerarRoteiroAcao = definirAcao({ funcionalidade: 'rel.apresentacao_diretoria', acao: 'executar', entrada }, (e, ctx) => gerarRoteiro(ctx, e));
export const exportarSlidesAcao = definirAcao({ funcionalidade: 'rel.apresentacao_diretoria', acao: 'exportar', entrada }, (e, ctx) => exportarSlides(ctx, e));
