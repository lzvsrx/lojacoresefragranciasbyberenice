export const PAYMENT_GUIDANCE = {
  "01": {
    title: "Dinheiro",
    description: "Para pagamento presencial ou na retirada.",
    reference: "Não é necessário comprovante de transação.",
    steps: "Informe o valor recebido na venda. O sistema calcula o troco.",
    instructions:
      "Pagamento na retirada. Informe o valor recebido para calcular o troco.",
  },
  "03": {
    title: "Cartão de crédito",
    description: "Receba pela maquininha ou por um link seguro da operadora.",
    reference: "NSU ou código de autorização da operadora.",
    steps:
      "Defina as parcelas conforme seu contrato. Informe ao cliente o total e as condições antes de cobrar.",
    instructions:
      "Confirme a aprovação na operadora e registre o NSU ou código de autorização.",
  },
  "04": {
    title: "Cartão de débito",
    description: "Receba pela maquininha ou solução da operadora.",
    reference: "NSU ou código de autorização.",
    steps: "Confira a aprovação da transação antes de entregar o produto.",
    instructions:
      "Pagamento à vista. Confirme a aprovação e registre o NSU ou código de autorização.",
  },
  15: {
    title: "Boleto bancário",
    description: "Emita o boleto em um banco ou provedor contratado.",
    reference: "Identificador do boleto ou da cobrança.",
    steps:
      "Mantenha o pedido pendente até confirmar a compensação no provedor.",
    instructions: "Aguarde a compensação do boleto antes de liberar o pedido.",
  },
  17: {
    title: "Pix dinâmico",
    description: "Cobrança individual gerada pelo seu banco ou provedor.",
    reference: "TxID ou EndToEndId do pagamento.",
    steps:
      "Gere a cobrança fora deste sistema e confira o recebimento no banco.",
    instructions:
      "Solicite o QR Code da cobrança à loja. O pedido será liberado após confirmação do recebimento.",
  },
  18: {
    title: "Transferência / carteira digital",
    description: "Receba pela instituição ou carteira que sua loja utiliza.",
    reference: "Identificador da transação fornecido pela instituição.",
    steps:
      "Confira o crédito na conta e registre a identificação da transação.",
    instructions:
      "Confirme os dados do recebedor com a loja e aguarde a confirmação do crédito.",
  },
  20: {
    title: "Pix estático",
    description: "Chave Pix ou QR Code reutilizável da loja.",
    reference: "EndToEndId ou identificação da transação recebida.",
    steps:
      "Confira recebedor, valor e entrada no extrato. Um comprovante enviado não substitui essa conferência.",
    instructions:
      "Solicite a chave Pix à loja e confira o nome do recebedor. A liberação depende da confirmação no extrato.",
  },
  99: {
    title: "Outros",
    description: "Use apenas para uma forma de recebimento definida pela loja.",
    reference: "Identificação que permita conferir o recebimento.",
    steps:
      "Explique como o cliente paga e como a equipe confirma o recebimento.",
    instructions:
      "Combine a forma de pagamento com a loja antes de concluir o pedido.",
  },
};

export const paymentGuidance = (code) =>
  PAYMENT_GUIDANCE[code] || PAYMENT_GUIDANCE["99"];
