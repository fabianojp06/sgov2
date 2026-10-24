---
name: "xau-mql5-hibrido"
description: "Versão híbrida MQL5 do robô XAU/USD — EA em MQL5 executa, serviço Python externo analisa notícias/IA e manda sinal"
---

- Quer o robô de ouro com IA e análise de notícias em MQL5, além da versão existente em Python ([[xauusd-mt5-bot]])
- Arquitetura escolhida: híbrida — serviço Python analisa notícias/IA e gera sinal; EA em MQL5 executa as ordens
- O robô Python existente ([[xauusd-mt5-bot]]) vai coexistir com o EA MQL5, não será substituído (Python fica responsável pela análise, MQL5 pela execução)
- Decisão de arquitetura: motor único com múltiplas estratégias isoladas em módulos (cada módulo recebe dados e devolve sinal + confiança/tamanho, sem conhecer as outras), uma camada de risk/portfolio management por cima decidindo alocação de capital por estratégia e resolvendo conflitos de sinais, e uma única camada de execução compartilhada entre todas as estratégias
