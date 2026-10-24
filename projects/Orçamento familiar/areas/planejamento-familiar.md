---
name: "planejamento-familiar"
description: "Sistema SaaS B2C de planejamento financeiro familiar com insights de IA"
---

- Ideação/desenvolvimento de um sistema SaaS B2C de planejamento financeiro familiar, completo, com "dinheiro da família" como centro (gastos, ganhos, carteira/patrimônio)
- Deverá contemplar insights de IA sobre gastos, ganhos e andamento da carteira/saúde financeira, exibidos em tela
- Carteira/patrimônio será lançamento manual pelo usuário (sem integração via Open Finance/corretoras no MVP)
- Insights gerados em modelo híbrido: lote periódico + recálculo sob demanda
- Decisão de entrega: PWA + versão web responsiva, sem app nativo no MVP (stack Next.js)
- Stack de PWA definida: Next.js + next-pwa (Workbox), IndexedDB para fila offline de lançamentos, Web Push/VAPID para notificações, Clerk para autenticação
- Quer implementar um consultor financeiro de IA autônomo que faz perguntas ao usuário e tira dúvidas
- Consultor de IA no MVP deve operar em modo reativo (chat livre) e proativo (IA inicia conversa)
- Consultor de IA também deve conduzir o onboarding inicial da família (perfil, metas, situação atual) de forma conversacional
- Nome do produto: "Onde Está Meu Dinheiro"
- Planos: Essencial (insights básicos) e Premium (com consultor de IA completo), com free trial
- Renda líquida mensal da família: R$ 15.000 + Vale Alimentação R$ 2.000 (benefício)
- Gastos fixos mensais mapeados: R$ 6.312,43 em débito em conta
- Família tem dois cartões de crédito Bradesco: Visa e Gol Smiles Visa Platinum (múltiplos adicionais, todos em nome de Ingrid)
- Meta financeira principal: viagem internacional em 2030 (família de 4: Fabiano, Ingrid, AC e JP)
- Reserva de emergência: zero — prioridade número 1 antes da viagem
- Maiores vazamentos identificados: vestuário (~R$ 1.345/mês em agosto ambos cartões), alimentação fora (~R$ 1.144/mês), tech/serviços (~R$ 743/mês), assinaturas Apple (múltiplas cobranças/mês ~R$ 230)
- Cartão Bradesco ...9706 é de Fabiano; cartão adicional ...0116 é de Ingrid
- Ingrid tem parcelamentos ativos: Wepink + Rabanne (01/05) — ainda 4 parcelas a vencer (~R$ 430/mês)
- Agosto fechou com déficit de ~R$ 278 por conta do imprevisto do carro (R$ 3.100 pontual)
- Fabiano tem padrão de gastos elevados em bares/restaurantes: ~R$ 843 em agosto só no seu cartão
- Ingrid usa Gol Smiles Visa Platinum com 3 cartões adicionais: ...2548, ...4708 e ...7546
