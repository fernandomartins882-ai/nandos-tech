# OrdemTech — protótipo PWA

## O que já funciona
- Dashboard inicial com indicadores.
- Cadastro e edição de produtos/peças, com custo, venda e estoque mínimo.
- Cadastro e edição de serviços, com custo e preço de venda.
- Cadastro e edição de clientes.
- Criação de orçamentos com produtos e serviços cadastrados.
- Cálculo de subtotal, desconto e total.
- Impressão/geração de PDF pelo diálogo de impressão do navegador.
- Atalho de compartilhamento pelo WhatsApp com mensagem pronta.
- Interface responsiva e estrutura PWA instalável.
- Persistência local no navegador via localStorage.

## Como testar
1. Extraia o ZIP.
2. Abra a pasta em um servidor local (recomendado: VS Code + extensão Live Server).
3. Acesse o endereço local pelo navegador.
4. Cadastre alguns produtos, serviços e clientes.
5. Crie um orçamento e use PDF / Imprimir.

Também pode publicar os arquivos em uma hospedagem estática HTTPS para testar a instalação como PWA.

## Limitações desta primeira entrega
Este é um MVP local, não uma versão multiusuário em nuvem. Os dados ficam no navegador/dispositivo em que foram cadastrados. Não há login, sincronização entre dispositivos, banco de dados remoto, envio automático de e-mail, PDV completo, módulo financeiro ou gestão de filiais nesta versão. Faça exportação/backup do navegador e não utilize dados reais sensíveis em ambiente de teste.

## Próxima etapa recomendada
Conectar a aplicação a um backend e banco de dados (por exemplo, Supabase), implementar autenticação e permissões, backup, sincronização e então completar vendas, ordens de serviço, financeiro, metas e filiais.
