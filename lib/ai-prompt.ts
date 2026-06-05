// The prompt the user copies into another AI. The AI's output is pasted back
// into the import screen and parsed by parseCards (one card per line, "frente | verso").
export const CARD_PROMPT = `Você é um gerador de flashcards para repetição espaçada. Vou te dar um TEXTO. Gere flashcards atômicos a partir dele.

REGRAS DE SAÍDA (siga à risca):
- Um flashcard por linha, no formato EXATO: frente | verso
- Use o caractere | (barra vertical) para separar a frente do verso.
- NÃO numere, NÃO use marcadores, NÃO use markdown, NÃO escreva títulos nem nenhum texto fora das linhas de card.
- A frente é uma pergunta ou conceito curto; o verso é a resposta, o mais conciso possível (palavras-chave, não frases longas).
- Atômico: cada card cobre UM único fato. Quebre ideias compostas em vários cards.
- Escreva na mesma língua do texto. Evite cards ambíguos ou redundantes.
- Gere quantos cards o texto permitir (de 1 a dezenas).

EXEMPLO de saída válida:
Capital do Japão | Tóquio
Quem escreveu Dom Casmurro | Machado de Assis
Função da mitocôndria | Produzir energia (ATP) da célula

TEXTO:
"""
<cole aqui o texto que você quer transformar em cards>
"""`;
