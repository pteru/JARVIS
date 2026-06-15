---
name: certificados
description: Use when working with digital certificates (A1/A3), tokens, smart cards, PDF signing, or accessing government portals (e-Fazenda, eCAC) on Linux Ubuntu
---

# Certificados Digitais — Referencia Linux

## Tokens Disponiveis

| Token | Label | Titular | Serial | Fabricante |
|-------|-------|---------|--------|------------|
| G&D StarSign CUT S | FenaconCD | Pedro Luiz Teruel | 014E0035001A6C17 | A.E.T. Europe B.V. |
| G&D StarSign CUT S | Token VALID | Pedro Luiz Teruel Filho | 026E0023001A5B07 | A.E.T. Europe B.V. |
| G&D StarSign CUT S | LEILA FAGUNDES BORGES TERUEL | Leila Fagundes Borges Teruel | 0020003800181C0E | A.E.T. Europe B.V. |

Todos sao tokens USB G&D (Giesecke & Devrient) StarSign CUT S. Basta trocar o token plugado para alternar entre certificados.

## Certificados A1 (Software)

| CN | CNPJ | Emissor | Validade | Arquivo |
|----|------|---------|----------|---------|
| LUME TECNOLOGIA LTDA | 35003145000120 | AC SAFEWEB RFB v5 | 2026-03-17 a 2027-03-17 | `~/.secrets/LUME TECNOLOGIA LTDA_35003145000120.pfx` |

Certificados A1 sao arquivos `.p12`/`.pfx` — nao precisam de token fisico.

### Importar A1 no Chrome (NSS)

```bash
pk12util -d sql:$HOME/.pki/nssdb -i "<caminho-do-arquivo>.pfx"
# Senha do NSS DB: Enter (vazio)
# Senha do PKCS12: senha do certificado
```

### Verificar A1 importado

```bash
# Listar certificados no NSS
certutil -d sql:$HOME/.pki/nssdb -L | grep -i lume

# Ver detalhes (validade, emissor)
certutil -d sql:$HOME/.pki/nssdb -L -n "NSS Certificate DB:LUME TECNOLOGIA LTDA:35003145000120"
```

### Cadeia ICP-Brasil (obrigatorio para A1)

O `.pfx` de certificadoras brasileiras geralmente NAO embute os CAs intermediarios. Sem eles, o Chrome rejeita o certificado com `ERR_BAD_SSL_CLIENT_AUTH_CERT`. Passos:

1. Extrair URL do CA emissor do certificado:
```bash
openssl pkcs12 -in cert.pfx -clcerts -nokeys -passin pass:SENHA -legacy | openssl x509 -noout -text | grep "CA Issuers"
```

2. Baixar e converter a cadeia (`.p7b` → `.pem`):
```bash
curl -sL "<URL-do-p7b>" -o /tmp/chain.p7b
openssl pkcs7 -in /tmp/chain.p7b -inform DER -print_certs -out /tmp/chain.pem
```

3. Separar e importar cada CA:
```bash
awk 'BEGIN{n=0} /-----BEGIN/{n++} {print > "/tmp/ca-"n".pem"}' /tmp/chain.pem
# Importar cada um (pular cert-0.pem que e vazio):
certutil -d sql:$HOME/.pki/nssdb -A -t "CT,C,C" -n "Nome do CA" -i /tmp/ca-N.pem
```

4. Verificar que a cadeia resolve:
```bash
certutil -d sql:$HOME/.pki/nssdb -V -u C -n "NSS Certificate DB:LUME TECNOLOGIA LTDA:35003145000120"
# Deve retornar: "certificate is valid"
```

**Flag `-legacy` obrigatoria** no OpenSSL 3.x — PFX brasileiros usam RC2-40-CBC (algoritmo legado).

**CAs instalados (LUME):**
- AC Raiz Brasileira v5 (root, auto-assinado)
- AC Secretaria da Receita Federal do Brasil v4 (intermediate)
- AC SAFEWEB RFB v5 (issuer direto)

### Remover A1 do NSS (se necessario)

```bash
certutil -d sql:$HOME/.pki/nssdb -D -n "NSS Certificate DB:LUME TECNOLOGIA LTDA:35003145000120"
```

## Driver e Middleware

| Item | Detalhe |
|------|---------|
| **Driver** | SafeSign Identity Client 3.8.0.0 (G&D America do Sul) |
| **Modulo PKCS#11** | `/usr/lib/libaetpkss.so` |
| **Download** | https://safesign.gdamericadosul.com.br/content/SafeSign_IC_Standard_Linux_ub2204_3.8.0.0_AET.000.zip |
| **Pacote** | `safesignidentityclient` (instalado com `--force-depends`, em `hold`) |
| **Token admin** | `/usr/bin/tokenadmin` (requer libwx — interface grafica nao funciona no Ubuntu 24.04) |

**IMPORTANTE:** O driver correto e o **SafeSign** (G&D), NAO o SafeNet (Thales/Gemalto). SafeNet e para tokens eToken 5110.

## Dependencias do Sistema

```bash
sudo apt install opensc pcsc-tools pcscd libccid
sudo systemctl enable pcscd --now
```

### Pacotes dummy (Ubuntu 24.04)

O SafeSign 3.8.0 foi feito para Ubuntu 22.04. No 24.04, duas dependencias tem nomes diferentes (`libwxbase3.0-0v5`, `libwxgtk3.0-gtk3-0v5`). A instalacao foi feita com `--force-depends` e o pacote foi marcado com `apt-mark hold` para nao travar o apt. O modulo PKCS#11 funciona sem essas libs (sao so para a GUI do tokenadmin).

## Integracao com Chrome

O Chrome usa o banco NSS em `~/.pki/nssdb/pkcs11.txt`. O modulo SafeSign foi registrado manualmente (o `modutil` tem bug de crash com OpenSSL no Ubuntu 24.04):

```
library=/usr/lib/libaetpkss.so
name=SafeSign
NSS=
```

**Requisitos:**
- Chrome instalado via `.deb` (NAO Snap — Snap nao acessa token USB)
- Token plugado ANTES de abrir o Chrome (senao o Chrome pode travar ao carregar o modulo)
- `pcscd` rodando: `sudo systemctl start pcscd`

**Firefox:** Tambem nao funciona via Snap. Se necessario, instalar via PPA Mozilla (`ppa:mozillateam/ppa`).

## Comandos Uteis

```bash
# Verificar se token e reconhecido
pcsc_scan

# Listar slots e info do token
pkcs11-tool --module /usr/lib/libaetpkss.so -L

# Listar certificados no token (pede PIN)
pkcs11-tool --module /usr/lib/libaetpkss.so -O --login

# Listar modulos NSS do Chrome
cat ~/.pki/nssdb/pkcs11.txt
```

## Assinatura de PDF no Linux

| Ferramenta | Status |
|------------|--------|
| **Okular** | Instalado. Ferramentas > Assinaturas Digitais > Assinar Digitalmente |
| **JSignPDF** | Alternativa Java. Apontar PKCS#11 para `/usr/lib/libaetpkss.so` |
| **LibreOffice Draw** | Abre PDF, Arquivo > Assinaturas Digitais |
| **Adobe Reader** | NAO existe para Linux (descontinuado em 2013) |

## Assinador Digital SEFAZ/MS (DTE)

- **URL:** https://www.assinadordigital.ms.gov.br/
- **Download:** https://www3.servicos.ms.gov.br/assinadordigital/AssinadorDigital-7.2.1-instalador.exe
- **Plataforma:** Windows APENAS (executavel Delphi nativo)
- **Para usar no Linux:** necessita VM Windows ou dual boot

## Portais Governamentais

| Portal | URL | Uso |
|--------|-----|-----|
| **e-Fazenda MS** | https://efazenda.servicos.ms.gov.br | NFP-e, DTE, ICMS Transparente |
| **eCAC** | https://cav.receita.fazenda.gov.br | Receita Federal |
| **NFS-e SJC** | https://notajoseense.sjc.sp.gov.br | Nota Fiscal de Servico (LUME — A1) |

## Troubleshooting

### Token nao reconhecido
```bash
sudo systemctl restart pcscd
pcsc_scan  # deve listar o token
```

### Chrome nao mostra certificado
1. Verificar se token esta plugado
2. Verificar `pcscd` rodando
3. Verificar `~/.pki/nssdb/pkcs11.txt` tem entrada SafeSign
4. Fechar e reabrir Chrome (le pkcs11.txt so na inicializacao)

### Chrome trava ao abrir
Provavelmente o modulo PKCS#11 esta registrado mas o token nao esta plugado. Remover a entrada SafeSign do `pkcs11.txt`, abrir Chrome, plugar token, fechar Chrome, readicionar entrada, reabrir.

### `modutil` crash (Assertion `lib' failed)
Bug do modutil com OpenSSL 3.x no Ubuntu 24.04. Editar `~/.pki/nssdb/pkcs11.txt` manualmente em vez de usar modutil.

### `apt` travado por SafeSign
```bash
sudo dpkg --remove --force-remove-reinstreq safesignidentityclient
sudo apt --fix-broken install
# ... fazer o que precisa ...
sudo dpkg --force-depends -i ~/Downloads/"SafeSign IC Standard Linux 3.8.0.0-AET.000 ub2204 x86_64.deb"
sudo apt-mark hold safesignidentityclient
```
