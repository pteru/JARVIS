# Wiki Técnico

Página para concentrar padrões de desenvolvimento, tutoriais, templates e referências.

# Implantação e Suporte

# Preparação de PCs
## Configuração Base
### Ubuntu 24.04 LTS Headless
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3391](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3391))
### Ubuntu 24.04 LTS Kiosk
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3431](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3431))
# Acesso Remoto
## GM
## ArcelorMittal Barra Mansa
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3291](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3291))
## Ferramentas Úteis
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3451](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3451))
# Infraestrutura Instalada
## GM
### Spark Eyes São José dos Campos - Liftgate

| **Device** | **Nome** | **OS** | **MAC** | **IP** | **User** | **Password** | **Obs** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| PC Industrial | STROKMATIC | Ubuntu 22.04.2 LTS (Linux 6.2.0-39-generic) | eno1: 00:07:32:BF:14:14<br>enp1s0: 00:07:32:BF:14:11<br>enp2s0: 00:07:32:BF:14:12<br>enp3s0: 00:07:32:BF:14:13 | eno1: 124.131.141.80<br>enp1s0: sem netplan<br>enp2s0: sem netplan<br>enp3s0: 192.168.60.100 | strokmatic | skm@@2022 | \*Problema de reboot loop ainda não solucionado |
| Cabeçote |  |  |  | 124.131.141.85 | strokmatic | skm@@2022 |  |
| IHM |  |  |  | 124.131.141.84 |  |  |  |

### Spark Eyes Gravataí - BSO-LH

### Spark Eyes São Caetano do Sul - Doors

## ArcelorMittal
### VK Barra Mansa TL1

| **Device** | **Nome** | **OS** | **MAC** | **IP** | **User** | **Password** | **Obs** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| Workstation Ponto 1 |  | Ubuntu 22.04.2 LTS (Linux 6.14.0-29-generic) | eno1: 00:07:32:BF:14:14<br>enp1s0: 00:07:32:BF:14:11<br>enp2s0: 00:07:32:BF:14:12<br>enp3s0: 00:07:32:BF:14:13 | eno1: 10.244.70.26<br>enp1s0: 192.168.101.1<br>enp2s0: 192.168.14.2<br>enp3s0: 192.168.15.71 | vk01 | skm@@2022 |  |
| Workstation Ponto 1 |  | Ubuntu 22.04.2 LTS (Linux 6.14.0-29-generic) |  | 10.244.70.50 | vk02 | skm@@2022 |  |
| PC Cabine Central |  | Ubuntu 22.04.2 LTS (Linux 6.14.0-29-generic) |  | 10.244.70.25 | vk03 | skm@@2022 |  |
| PC Cabine Corte a Frio |  | Ubuntu 22.04.2 LTS (Linux 6.14.0-29-generic) |  | 10.244.70.67 (confirmar) | vk04 | skm@@2022 |  |

## Hyundai
### Spot Fusion Piracicaba - Floor

| **Device** | **Nome** | **OS** | **MAC** | **IP** | **User** | **Password** | **Obs** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| PC Industrial | STROKMATIC-PROD | Ubuntu 24.04.2 LTS (Linux 6.14.0-29-generic) | eno1: 00:07:32:BF:14:14<br>enp1s0: 00:07:32:BF:14:11<br>enp2s0: 00:07:32:BF:14:12<br>enp3s0: 00:07:32:BF:14:13 | eno1: 192.168.100.1<br>enp1s0: 192.168.101.1<br>enp2s0: 192.168.14.2<br>enp3s0: 192.168.15.71 | spotfusion | skm@@2022 | Ainda não enviado |
| IHM |  |  |  | 124.131.141.84 |  |  |  |

# Ubuntu 24.04 LTS Headless

# Setup manual
## Instalações base
### Updates gerais

```bash
sudo apt update && sudo apt upgrade -y
```

### Ferramentas essenciais
#### openssh

```bash
# Instalar servidor SSH
sudo apt install openssh-server -y

# Checar status do serviço após a instalação
sudo systemctl status ssh

# Caso esteja 'disabled', executar o comando abaixo e checar novamente
sudo systemctl enable ssh
sudo systemctl status ssh
```

*   A imagem mostra o status após o servidor SSH ser iniciado com sucesso. Após a instalação, o PC pode ser acessado na rede via SSH.
![](https://t3081126.p.clickup-attachments.com/t3081126/10c79f55-0d53-4f51-b21e-7ed99e2b24e7/image.png)
#### curl
*   Utilizado na instalação de outras ferramentas

```bash
sudo snap install curl
```

![](https://t3081126.p.clickup-attachments.com/t3081126/aa977a05-ba50-40b4-871c-2d81ba5aa82d/image.png)
#### docker

```bash
# Instala docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Adiciona usuário ao grupo docker
sudo usermod -aG docker $USER
newgrp docker

# Verificar instalação
docker run hello-world
```

![](https://t3081126.p.clickup-attachments.com/t3081126/0f4ec881-110f-4787-bd3c-86575550ed5a/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/4af8d0fc-ac58-4f4d-bf92-d6c877b3f162/image.png)
#### chrony (NTP server)
*   Necessário para sincronizar timestamp com outras máquinas

```bash
# Instalar Chrony
sudo apt install chrony -y

# Abrir configurações para edição
sudo nano /etc/chrony/chrony.conf
```

*   No arquivo `chrony.conf` , adicionar o comando abaixo para liberar conexões dos IPs desejados

```bash
# Allow NTP client access from local network.
allow 192.168.1.0/24
```

Necessário apenas se o PC for referência de timestamp para outras máquinas.

*   Salvar com `Ctrl+O` , `Enter` , `Ctrl+X` .
*   Reiniciar e checar status.

```bash
sudo systemctl restart chrony
sudo systemctl status chrony
```

### ![](https://t3081126.p.clickup-attachments.com/t3081126/3f1a2fd3-a166-40a2-9ddd-b7d4793020a6/image.png)
#### net-tools
*   Pacote de ferramentas que inclui o `ifconfig`

```bash
sudo apt install net-tools -y
```

### Ferramentas opcionais
#### MVS
*   Instalacão:

**Linux:**
TODO: INSTRUCÕES DE INSTALACÃO

**Windows:**
TODO: INSTRUCÕES DE INSTALACÃO

*   Para executar o MVS, execute o comando abaixo em um terminal

```bash
bash /opt/MVS/bin/MVS.sh
```

**Importante:** mantenha o terminal aberto enquanto usa o MVS. O terminal ficará ocupado com o processo até o MVS ser fechado.

*   Para acessar o MVS de uma máquina remota a partir do computador local, deve-se fazer o acesso via SSH com a flag `-X` habilitando a sessão gráfica

```bash
ssh user@ipaddress -X
```

*   Uma vez conectado, basta usar o comando mostrado acima para executar o MVS. A janela gráfica se abrirá no cmputador local que está fazendo o acesso remoto.
### Ferramentas úteis
#### nmap

```plain
sudo apt install nmap -y
```

#### iperf3

```plain
sudo apt install iperf3 -y
```

#### squid
*   Ferramenta para estabelecer um túnel via SSH

```plain
sudo apt install squid -y
```

### Ferramentas em teste
#### kubernetes

```bash
# Instalação
sudo snap install microk8s --classic

# Adicionar user ao grupo
sudo usermod -aG microk8s $USER
newgrp microk8s

# Verificar instalação
microk8s status --wait-ready
```

#### helm

```bash
# Instalação
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verificar instalação
helm version
```

## Autenticação da Service Account de deploy
### Instalação

```bash
# Adicionar o URI do Cloud SDK
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list

# Importar a chave pública do Google Cloud
sudo apt-get install apt-transport-https ca-certificates gnupg -y
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -

# Instalar o SDK
sudo apt-get update && sudo apt-get install google-cloud-sdk -y
```

### Autenticação no Docker
*   Copiar chave da conta de serviço em um path conhecido do computador

[

drive.google.com

https://drive.google.com/file/d/1eghWiYZKksPo60MKSR7IrOmOiXZ2odoX/view?usp=drive\_link

](https://drive.google.com/file/d/1eghWiYZKksPo60MKSR7IrOmOiXZ2odoX/view?usp=drive_link)

*   Executar os comandos para autenticar

```bash
# Instalar auth plugin
# sudo apt-get install google-cloud-sdk-gke-gcloud-auth-plugin -y

# Autenticar com service account deploy-assistant
gcloud auth activate-service-account --key-file=~/deploy-assistant.json

# Verificar a instalação
gcloud auth list
gcloud projects list

# Configurar o docker para a região do repositório
gcloud auth configure-docker us-central1-docker.pkg.dev
gcloud auth configure-docker southamerica-east1-docker.pkg.dev
```

# ![](https://t3081126.p.clickup-attachments.com/t3081126/0da24ed4-4155-4620-b3f0-ca433cae10de/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/c869749c-a1cf-495d-b710-8a63334aabbb/image.png)
## Netplan
A pasta `/etc/netplan` deve conter os seguintes arquivos:
*   `01-network-manager-all.yaml`
Arquivo em branco
*   `99-custom.yaml`
Arquivo que configura o IP principal da máquina

```yaml
network:
  version: 2
  renderer: NetworkManager
  ethernets:
    ${ETHERNET_ADAPTER_PRINCIPAL}:
      addresses: [${IP_PRINCIPAL}/24]
      routes:
        - to: default
          via: ${GATEWAY_PRINCIPAL} # Padrão: IP com último octeto 1
      nameservers:
          addresses: [${GATEWAY_PRINCIPAL}, 8.8.8.8]
```

*   `01-netcfg.yaml`
Arquivo necessário apenas se houver outros adaptadores Ethernet no computador, tais como placas FrameGrabber para conexão de câmeras ou portas adicionais para outros dispositivos.

```yaml
network:
  version: 2
  ethernets:
    ${FRAMEGRABBER_PORTA_1}:
      addresses:
        - ${IP_CAMERA_1}/24 # Padrão: 192.168.10.2
    ${FRAMEGRABBER_PORTA_2}:
      addresses:
        - ${IP_CAMERA_2}/24 # Padrão: 192.168.20.2
    ${FRAMEGRABBER_PORTA_3}:
      addresses:
        - ${IP_CAMERA_3}/24 # Padrão: 192.168.30.2
    ${FRAMEGRABBER_PORTA_4}:
      addresses:
        - ${IP_CAMERA_4}/24 # Padrão: 192.168.40.2
    ${ADAPTER_ADICIONAL}:
      addresses:
        - ${IP_DEVICE_ADICIONAL}/24 # Padrão: 192.168.50.1
```

Após editar todos os arquivos, rodar o comando abaixo para efetivar a alteração

```bash
sudo netplan apply
```

Caso o endereço IP seja alterado durante uma conexão via SSH, a conexão será perdida e deverá ser reestabelecida no novo endereço.

### Exemplos ArcelorMittal
#### VK01
*   Placa de rede adicional com 1 porta para o controlador de iluminação
![](https://t3081126.p.clickup-attachments.com/t3081126/7bf0d44b-818a-4579-9767-c1d06aab747d/Captura%20de%20tela%20de%202025-09-17%2011-44-22.png)
#### VK02
*   FrameGrabber com 4 portas para 4 câmeras GigE
*   Adaptador USB-Ethernet com 1 porta para o controlador de iluminação
![](https://t3081126.p.clickup-attachments.com/t3081126/4901a98e-33c3-441f-8edb-1d9e51cea8d6/Captura%20de%20tela%20de%202025-09-17%2011-43-53.png)
# Setup a partir de imagem

# Ubuntu 24.04 LTS Kiosk



# Instruções para Conexão Remota e Deployment na ArcelorMittal

# Acesso Remoto
## Caminho 1: Conexão ao VPN
### Configuração
O VPN da ArcelorMittal usa o provedor Check Point. Ele pode ser acessado no endereço:

[

novoacesso.arcelormittal.com.br

https://novoacesso.arcelormittal.com.br/Login/Login

](https://novoacesso.arcelormittal.com.br/Login/Login)

Para configuração da conexão em Linux, é necessário realizar a instalação da ferramenta de conexão da Check Point, por meio de um arquivo SH

**Observação:** Existe uma versão do arquivo `.sh` para cada local de instalação do Firefox na máquina. Verificar qual é o caso adequado.

#### Link para Firefox instalado via snap (mais comum):

[

drive.google.com

https://drive.google.com/file/d/1HUJzmL1c4qSwwts4zJ2ULWoXFdyZnexO/view?usp=drive\_link

](https://drive.google.com/file/d/1HUJzmL1c4qSwwts4zJ2ULWoXFdyZnexO/view?usp=drive_link)

#### Link para Firefox instalado via apt (baixado do Check Point):

[

drive.google.com

https://drive.google.com/file/d/1t0Q6vazkVo2PTNNXxBhrVtUUBsnSWK8J/view?usp=drive\_link

](https://drive.google.com/file/d/1t0Q6vazkVo2PTNNXxBhrVtUUBsnSWK8J/view?usp=drive_link)

**Atenção! Não abra o arquivo** **`.sh`** **em um editor de texto, pois isso corrompe o arquivo.**

Uma vez baixado o arquivo `.sh`, basta executar com o seguinte comando:

```bash
# Executar o arquivo baixado, ajustando para o nome correto
sudo sh cshell_install_{versão}.sh
```

### Conexão Check Point VPN
Uma vez aberto o site, será solitado usuário e senha. O usuário que usamos é o do Felipe Pavão, da ArcelorMittal, que é o único que tem os acessos que precisamos para chegar até as máquinas do laminador.

![](https://t3081126.p.clickup-attachments.com/t3081126/7dc083ee-7326-40ac-bbf7-e2765f0405e1/image.png)

Após o login, será solicitado um PIN de 6 dígitos, que é enviado ao celular do Felipe via SMS. Antes de enviar o PIN, confirme com o Felipe se ele está a postos para encaminhar o PIN, pois ele expira em poucos minutos.

Uma vez feito o login, basta clica em Conectar e aguardar para que a conexão seja realizada.

![](https://t3081126.p.clickup-attachments.com/t3081126/958b5e9b-e662-4ea0-96e6-99965619a083/image.png)

**Atenção!** A conexão tem um tempo limite de 12 horas consecutivas para cada login realizado. Caso o tempo expire, é necessário reiniciar todo o processo de login, com um novo PIN. O tempo restante é mostrado na tela de conexão.

#### Solução de Problemas (VPN/CShell)
Caso a conexão falhe, siga estes passos:

1 - Identifique se o serviço já está rodando na porta 14186:

```bash
sudo lsof -i :14186
```

2 - Mate o processo existente:

```bash
sudo kill -9 [NÚMERO_DO_PID]
```

3 - Vá para o diretório 

```bash
cd /bin/cshell
```

4 - Execute manualmente para ver os logs de erro:

```bash
sudo java -jar CShell.jar
```

###   

Dessa forma é possível visualizar os logs de erros que estão acontecendo ao tentar conectar.

### Erros mapeados
#### Dependências 32 bits (Erro SNX)
O SNX (componente da VPN) exige bibliotecas de 32 bits para funcionar em distros modernas:

```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install libstdc++6:i386 libpam0g:i386 libx11-6:i386 libnss3-tools
```

#### Verificar o binário SNX
O Java tentará executar /usr/bin/snx. Verifique se ele existe e quais dependências faltam:

```bash
ls -l /usr/bin/snx
ldd /usr/bin/snx
```

_Se houver bibliotecas com "not found", instale-as (ex: sudo apt install libstdc++5:i386)._

### Conexão Direta (Método Recomendado)
Após conectar na VPN, não é mais necessário passar por várias máquinas Windows. Você pode conectar diretamente do seu terminal.

#### **Acesso via SSH**
Utilize a porta **8050** para saltar diretamente para a máquina de destino:

```bash
ssh -p 8050 vk01@10.244.70.26
```

####   

#### Transferência de Arquivos (SCP)
Para enviar arquivos (como imagens .tar), utilize a flag -P (maiúsculo) para a porta:

```bash
# Exemplo: enviando uma imagem docker
scp -P 8050 ./minha_imagem.tar vk01@10.244.70.26:/home/vk01/Downloads
```

### Conexão Remmina \[DESATUALIZADO\]
Uma vez conectado, o próximo passo é estabelecer conexão remota com um servidor da manutenção usando o Remmina com o protocolo Remote Desktop Protocol. Os parâmetros de conexão são mostrados abaixo.

![](https://t3081126.p.clickup-attachments.com/t3081126/951855a5-6f0b-484e-a000-7636e1633bcf/image.png)

Após estabelecida a conexão, será acessada uma área de trabalho Windows, conforme mostrado abaixo.

![](https://t3081126.p.clickup-attachments.com/t3081126/f2638942-ee3e-4774-9c75-d4c6c38fe8dd/image.png)

Os arquivos de atualização enviados podem ser encontrados na pasta `strokmatic` , conforme as imagens abaixo.

![](https://t3081126.p.clickup-attachments.com/t3081126/efb6ee74-02db-407a-be89-20d2108b9f55/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/6d1f5d3d-f790-4ec2-81fd-922f01f73279/image.png)

**Atenção!** Essa pasta é excluída periodicamente. Para arquivos grandes, sempre termine a transferência até as máquinas do sistema, para evitar retrabalhos.

A pasta compartilhada, conforme configurado na conexão do Remmina, pode ser acessada pelo `Meu Computador / This PC` , conforme mostrado abaixo.

![](https://t3081126.p.clickup-attachments.com/t3081126/a134461f-9079-4e62-a1a1-8b141feba9ed/image.png)

**Atenção!** A transferência de arquivos e pastas entre a pasta compartilhada e a pasta local é a etapa mais demorada, pois é quando o arquivo trafega pela internet.

**Atenção!** Enquanto uma transferência ocorre, qualquer outro uso da máquina remota fica extremamente lento, a ponto de inviabilizar que qualquer outra coisa seja feita simultaneamente. Planeje o trabalho para que o Remmina fique sem uso durante a transferência.

**Atenção! A conexão do Remmina é terminada após alguns minutos de inatividade. Em caso de transferência de arquivos grandes, é necessário ficar mexendo no computador para garantir que a conexão não seja interrompida.**
**Para viabilizar transferências parciais de arquivos grandes, seguir procedimento de** **_split_** **abaixo.**

#### Transferência de arquivos grandes (.tar)

Para transferências de imagens de containeres exportadas para arquivos `.tar`, pode-se aplicar duas transformações de forma a reduzir o tamanho total e particionar em arquivos menores, possibilitando o envio parcial caso haja instabilidade na conexão.

Os passos são:
1. Comprimir o arquivo `.tar` para `.tar.gz`
    *   normalmente já reduz o tamanho total pela metade
2. Particionar o arquivo `.tar.gz` em diversos arquivos de tamanho máximo configurado
    *   recomendado: 100MB por partição

Os comandos são os seguintes:

```perl
# comprimir arquivo .tar para .tar.gz
tar -czvf {image}.tar.gz {image}.tar

# dividir o arquivo em partições de 100MB
split -b 100M {image}.tar.gz split_{image}_
```

Isso vai gerar diversos arquivos na pasta base, com o nome `split_{image}_*`, em que `*` é um sufixo sequencial.

![](https://t3081126.p.clickup-attachments.com/t3081126/c4c83717-6917-44fe-875f-0bc3fb24fc99/image.png)

Depois de particionados, os arquivos podem ser transferidos seguindo o procedimento explicado acima. Como a rotina de consolidação é rodada apenas nas máquinas Linux do sistema, toda a transferência até as máquinas do sistema são feitas com os arquivos particionados.

Para reconstrução, segue-se os passos inversos:

```perl
# consolidar os arquivos em um único arquivo .tar.gz
cat split_{image}_* > {image}.tar.gz

# extrair .tar.gz para arquivo .tar
tar -xzvf {image}.tar.gz
```

O último comando vai gerar o arquivo `{image}.tar` original, que pode ser carregado com um comando `sudo docker load -i {image}.tar`.
### Conexão Remote Desktop
A partir do servidor acessado pelo Remmina, é necessário estabelecer outra conexão remota com um computador da manutenção, que fica no chão de fábrica e tem acesso à rede do laminador.

Essa segunda camada de conexão é realizada via Remote Desktop, conforme imagens abaixo.

![](https://t3081126.p.clickup-attachments.com/t3081126/48e0d7a6-677d-4a3c-b1c9-01c064364951/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/66a929d5-657a-4c6f-9438-c4f5ef17c8ee/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/adcc13b5-7eaf-41a4-ae9e-a21841611348/image.png)

**Atenção!** Enquanto o servidor sempre permite o acesso, o computador da manutenção tem seu uso compartilhado, e ocasionalmente pode estar sendo usado por alguém. Neste caso, aguarde um pouco e tente novamente o acesso.

**Em caso de urgência, ligue para o Felipe ou o Liomar, para que ele informe ao time de manutenção que precisamos acessar imediatamente.**

Quando existe algum outro acesso a essa máquina, será mostrado um aviso conforme a imagem abaixo. Nesse caso, basta clicar em **"Yes"** e aguardar a conexão.

![](https://t3081126.p.clickup-attachments.com/t3081126/f7e5e364-1860-4cd9-bea8-3e5ab38d47cb/image.png)

Uma vez conectado, será aberta uma nova área de trabalho Windows. Na Área de Trabalho, também existe uma pasta chamada `strokmatic` onde os arquivos de atualização são mantidos

![](https://t3081126.p.clickup-attachments.com/t3081126/0d541d61-231b-4a69-8bc6-587f2d205e45/image.png)

Os arquivos podem ser enviados do primeiro servidor para essa máquina por `Copy+Paste` simples, entre as duas máquinas Windows.

Também nessa pasta, há um Firefox Portable para acesso a serviços como Redis, RabbitMQ, PGAdmin, VZ e o Frontend.

![](https://t3081126.p.clickup-attachments.com/t3081126/8fc886ac-8bbc-4659-ae4a-2cb106ec3feb/image.png)

Para acesso via SSH às maquinas do sistema, pode-se usar o Windows PowerShell, que suporta de forma nativa comandos como `ssh` e `scp` . Sugere-se abrir o terminal a partir da pasta com os arquivos de atualização, para simplificar os comandos `scp` .

![](https://t3081126.p.clickup-attachments.com/t3081126/b0469461-e350-424b-bd68-664293661b3e/image.png)

Uma vez conectado via SSH, pode-se então iniciar os trabalhos de monitoramento, atualização e diagnósticos.

![](https://t3081126.p.clickup-attachments.com/t3081126/52d64254-6085-4809-a4d3-031ee5ed5bcc/image.png)
## Caminho 2: Conexão via AnyDesk
Esse caminho depende da presença da equipe da Strokmatic na planta, com um notebook conectado ao switch e o Modem 4G da Claro conectado à internet.

Nesse caso, basta conectar à máquina via AnyDesk e usar diretamente o navegador para acessar as portas e o terminal para o acesso SSH.

## Conexão SSH
Tanto pelo **Caminho 1** quanto pelo **Caminho 2**, uma vez conectado às máquinas do sistema via SSH, os comandos e procedimentos de interação com o sistema são os mesmos.
### Atualização da imagem de um serviço

### Atualização de `env` de um serviço

Exemplos: Endereços IP, `SAFETYFACTOR` do CT, `HASH_FIELDS` do IS

### Atualização de um arquivo `bind` de um serviço

Exemplos: Arquivo `json` do PM, Arquivo `mfs` do CA

### Interrupção de serviços

Exemplos: CA para configuração de câmera, PM para alteração manual de tags

# Configuração DHCP de Porta Ethernet

### 1\. Definir IP fixo na porta que será DHCP
#### Obter nome do adapter

```plain
ifconfig

enxf8e43bbf9916: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet6 fe80::6b6c:b825:6805:bc5c  prefixlen 64  scopeid 0x20<link>
        ether f8:e4:3b:bf:99:16  txqueuelen 1000  (Ethernet)
        RX packets 0  bytes 0 (0.0 B)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 0  bytes 0 (0.0 B)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0
```

#### Criar netplan para definir IP fixo

```plain
sudo nano /etc/netplan/99-custom.yaml
```

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    enxf8e43bbf9916: # <-- CHANGE THIS to your interface name
      dhcp4: no
      addresses: [192.168.50.1/24] # <-- This is the PC's static IP
      link-local: []
      ignore-carrier: true
```

#### Aplicar netplan

```plain
sudo netplan apply
```

#### Verificar aplicação do IP

```plain
ifconfig enxf8e43bbf9916

enxf8e43bbf9916: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 192.168.50.1  netmask 255.255.255.0  broadcast 192.168.50.255
        inet6 fe80::fae4:3bff:febf:9916  prefixlen 64  scopeid 0x20<link>
        ether f8:e4:3b:bf:99:16  txqueuelen 1000  (Ethernet)
        RX packets 0  bytes 0 (0.0 B)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 0  bytes 0 (0.0 B)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0
```

### 2\. Instalar servidor DHCP no PC

```plain
sudo apt update
sudo apt install isc-dhcp-server -y
```

### 3\. Editar arquivo de configuração

```plain
sudo nano /etc/dhcp/dhcpd.conf
```

#### Adicionar no final do arquivo:

```plain
# Configuration for the direct P2P service port
subnet 192.168.50.0 netmask 255.255.255.0 {
  range 192.168.50.100 192.168.50.150;      # IP pool for the service laptop
  option routers 192.168.50.1;               # The gateway is the industrial PC itself
  option domain-name-servers 8.8.8.8, 8.8.4.4; # Optional: Google's DNS
}
```

### 4\. Editar arquivo de do servidor

```plain
sudo nano /etc/default/isc-dhcp-server
```

#### Adicionar nome do adapter no arquivo:

```plain
INTERFACESv4="enxf8e43bbf9916" # <-- CHANGE THIS
```

### 5\. Iniciar servidor DHCP

```plain
sudo systemctl start isc-dhcp-server
sudo systemctl enable isc-dhcp-server # Makes it start on boot
```

#### Verificar status

```plain
sudo systemctl status isc-dhcp-server
```

![](https://t3081126.p.clickup-attachments.com/t3081126/85d9a01f-22b7-4188-8a77-cf5332e66676/image.png)
### 6\. Varrer o range de IPs para descobrir os IPs atribuídos
### ![](https://t3081126.p.clickup-attachments.com/t3081126/71a70d8c-e30e-4335-bad3-3e58df348f0b/image.png)
### 7\. Conectar-se ao outro dispositivo via SSH
![](https://t3081126.p.clickup-attachments.com/t3081126/9b043505-7b42-46ca-a956-0d834420f689/image.png)

# Software

# Referências
## Lista de Repositórios
### Vision King

| **Repositório** | **Descrição** | **Linguagem** | **Migração GitHub** | **Desenvolvedor** | **Último a editar** |
| ---| ---| ---| ---| ---| --- |
| [visionking-backend](https://github.com/strokmatic/visionking-backend) | Backend do sistema Vision King.<br><br> | NestJS | OK | Guilherme Gonçalves | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [visionking-frontend](https://github.com/strokmatic/visionking-frontend) | Frontend do sistema Vision King.<br><br> | Angular | OK | Gabrieli | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [visionking-backend-ds](https://github.com/strokmatic/visionking-backend-ds) | Backend do sistema Vision King, versão Body (IRIS), seguindo Design System.<br><br> | NestJS | OK | [@Guilherme Teixeira Santos](#user_mention#87301649) | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [visionking-frontend-ds](https://github.com/strokmatic/visionking-frontend-ds) | Frontend do sistema Vision King, versão Body (IRIS), seguindo Design System<br><br> | Angular | OK | [@Guilherme Teixeira Santos](#user_mention#87301649) | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [visionking-camera-acquisition](https://github.com/strokmatic/visionking-camera-acquisition) | Serviço de comunicação com câmeras usando protocolo Genicam em implementação própria baseada em Aravis.<br><br> | C++ | OK | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-image-saver](https://github.com/strokmatic/visionking-image-saver) | Serviço de monitoramento de imagens em cache KeyDB e salvamento em disco.<br><br> | Python | OK | Guilherme di Marzo | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-inference](https://github.com/strokmatic/visionking-inference) | Serviço de inferência de modelos YOLO V11. Preparado para TensorRT. Para aplicação sem GPU, reconfigura automaticamente para rodar em CPU.<br><br>detection<br><br><br>ONNX com TensorRT<br><br><br>sem slicing<br><br><br>sem filtering<br><br> | Python | OK | [@Pedro Teruel](#user_mention#3148447) | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-visualizer](https://github.com/strokmatic/visionking-visualizer) | Aplicação com tela de visualização de streaming de câmeras, status de PLC e métricas de containers.<br><br><br> | Python | OK | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-setup](https://github.com/strokmatic/visionking-setup/) | Conjunto de scripts e arquivos YML para montar serviços de infraestrutura.<br><br><br><br> | SQL/SH | OK | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-length-measure](https://github.com/strokmatic/visionking-length-measure) | Rotina de processamento de imagens e cálculo de comprimento de barras. | Python | OK | [@Pedro Teruel](#user_mention#3148447) | [@William Chiou Abe](#user_mention#54925168) |
| [visionking-pixel-to-object](https://github.com/strokmatic/visionking-pixel-to-object) | Serviço que converte coordenadas 2D de uma imagem para coordenadas 3D na peça.<br><br> | Python | OK | [@Pedro Teruel](#user_mention#3148447) | [@Pedro Teruel](#user_mention#3148447) |
| [visionking-database-writer](https://github.com/strokmatic/visionking-database-writer) | Serviço que recebe uma mensagem em formato JSON e envia a uma função do banco de dados PostgreSQL.<br><br> | Python | OK | Miraceli | [@Pedro Teruel](#user_mention#3148447) |
| visionking-result | [@William Chiou Abe](#user_mention#54925168) | Python | OK | [@William Chiou Abe](#user_mention#54925168) | [@William Chiou Abe](#user_mention#54925168) |
| visionking-sealer-measure | Serviço que mede o cordão de selar aplicado no assoalho a partir de image, numve de pontos e arquivo CAD.<br><br> | Python | OK |  |  |
| [visionking-plc-monitor](https://github.com/strokmatic/visionking-plc-monitor) | PLC Monitor. Conecta com PLCs da Siemens via Profinet e realiza leituras frequentes e escritas em DBs configurados via arquivo json. Espelha valores em um db do KeyDB. | C++ | OK | [@William Chiou Abe](#user_mention#54925168) | [@William Chiou Abe](#user_mention#54925168) |
| [visionking-storage-monitor](https://github.com/strokmatic/visionking-storage-monitor) | Storage Monitor. Script bash para monitorar o disco configurado e apagar arquivos mais antigos quando limite configurado é atingido. Estável. | SH | OK | Marcus Vinicius | Marcus Vinicius |
| [visionking-controller](https://github.com/strokmatic/visionking-controller) | Controller. Conectar e interfaceia com controlador de iluminacão das câmeras, modulando a intensidade e frequência dos iluminadores e disparando triggers de captura das câmeras de forma sincronizada. | C++ | OK | Marcus Vinicius | [@Pedro Teruel](#user_mention#3148447) |
| [bd-sis-surface](https://source.cloud.google.com/sis-surface/bd-sis-surface) | Backup Device. Realiza backup automático entre duas pastas. Não está em uso atualmente. | Python | To Do | [@Arthur Henrique Mallman](#user_mention#55072352) | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [bc-sis-surface](https://source.cloud.google.com/sis-surface/bc-sis-surface) | Backup Cloud. Desenvolvimento interrompido, mas pode ser útil futuramente. | Python | To Do | [@Arthur Henrique Mallman](#user_mention#55072352) | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [cloud-pipeline](https://source.cloud.google.com/sis-surface/cloud-pipeline) | **Infra**. Rotina de upload e tratamento de imagens para armazenamento do Cloud Storage e carregamento no Label Studio. | Python | To Do | [@Pedro Teruel](#user_mention#3148447) | Guilherme Lima Gonçalves |
| [test-infra-sis-surface](https://source.cloud.google.com/sis-surface/test-infra-sis-surface) | **Infra**. Scripts para montar ambiente de testes do Vision King, a partir de dumps representativos dos bancos de dados PostgreSQL e KeyDB.<br><br> | SH | To Do | Guilherme Lima Gonçalves | Guilherme Lima Gonçalves |
| [fl-sis-surface](https://source.cloud.google.com/sis-surface/fl-sis-surface) | **Infra**. Projeto para deployment do Label Studio. Não está em uso. | SH | To Do | Guilherme Lima Gonçalves | Guilherme Lima Gonçalves |
| [yolo-sis-surface](https://source.cloud.google.com/sis-surface/yolo-sis-surface) | **Data Science**. Scripts de treinamento do YOLO.<br><br><br> | Python | To Do | [@Matheus Vilar Mota Santos](#user_mention#81503678) | [@Matheus Vilar Mota Santos](#user_mention#81503678) |
| [opt-sis-surface](https://source.cloud.google.com/sis-surface/opt-sis-surface) | **Data Science**. Otimizador de parâmetros para os filtros. Usa o `ft-sis-surface` como submódulo. | Python | To Do | [@Matheus Vilar Mota Santos](#user_mention#81503678) | [@Matheus Vilar Mota Santos](#user_mention#81503678) |
| [ft-sis-surface](https://source.cloud.google.com/sis-surface/ft-sis-surface) | **Data Science**. Estudo de filtros analíticos. Submódulo de `opt-sis-surface` .<br><br> | Python | To Do | Matheus Gomes | [@Matheus Vilar Mota Santos](#user_mention#81503678) |
| [an-sis-surface](https://source.cloud.google.com/sis-surface/an-sis-surface) | Analyzer. Não sei do que se trata.<br>@William Chiou Abe<br><br> | Python | ??? | ? | ? |
| [if-sis-surface](https://source.cloud.google.com/sis-surface/if-sis-surface) | Inference Server. Incorporado no `visionking-inference` | Python | Descontinuado | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [dm-sis-surface](https://source.cloud.google.com/sis-surface/dm-sis-surface) | Default Module. Incorporado no `visionking-inference` | Python | Descontinuado | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [cache-api-sis-surface](https://source.cloud.google.com/sis-surface/cache-api-sis-surface) | API para buscar imagens no Redis. Incorporado no `visionking-visualizer` | C++ | Descontinuado | Matheus Gomes | Matheus Gomes |
| [rc-sis-surface](https://source.cloud.google.com/sis-surface/rc-sis-surface) | Result Calculator. Incorporado no `visionking-database-writer` . | Python | Descontinuado | Miraceli | [@Pedro Teruel](#user_mention#3148447) |
| [etl-sis-surface](https://source.cloud.google.com/sis-surface/etl-sis-surface) | Desenvolvimento suspenso. Será implementado diretamente no PostgreSQL. | Python | Descontinuado | Miraceli | Miraceli |
| [gi-sis-surface](https://source.cloud.google.com/sis-surface/gi-sis-surface) | Get Image. Nunca foi implementado. | C++ | Descontinuado | Matheus Gomes | Matheus Gomes |
| [collections-sis-surface](https://source.cloud.google.com/sis-surface/collections-sis-surface) | Documentação de banco de dados MongoDB. Substituído para PostgreSQL. | JSON | Descontinuado | Miraceli | Miraceli |
| [Itransformers](https://source.cloud.google.com/sis-surface/Itransformers) | Implementação relacionada à medição de comprimento. Descontinuado. | Python | Descontinuado | Miraceli | Miraceli |
| [res-sis-surface](https://source.cloud.google.com/sis-surface/res-sis-surface) | Repositório vazio | \- | \- | \- | \- |

### Spot Fusion

| **Repositório** | **Descrição** | **Linguagem** | **Migração GitHub** | **Desenvolvedor** | **Último a editar** |
| ---| ---| ---| ---| ---| --- |
| [camera-acquisition](https://source.cloud.google.com/spark-eyes/camera-acquisiiton) | **Cabeçote**. Serviço de conexão com a câmera e captura do buffer de imagem. Realiza streaming de forma constante para um cache no Redis.<br><br><br><br> | Python | To Do | Matheus Gomes | Matheus Gomes |
| [controler-devices](https://source.cloud.google.com/spark-eyes/controler-devices) | **Cabeçote**. Serviço de conexão com ESP32 e gerenciamento de periféricos do cabeçote.<br><br><br> | Python | To Do | Matheus Gomes | Matheus Gomes |
| [data-enrichment](https://source.cloud.google.com/spark-eyes/data-enrichment) | Serviço de concatenação de imagens com as respectivas curvas elétricas.<br><br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [database-write](https://source.cloud.google.com/spark-eyes/database-write) | Serviço que recebe queries via mensagem e executa no banco de dados PostgreSQL.<br><br> | Python | To Do | Gustavo Camargo | Matheus Gomes |
| [default-module](https://source.cloud.google.com/spark-eyes/default-module) | Serviço de inferência sem imagens, rodando em CPU.<br><br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [get-data](https://source.cloud.google.com/spark-eyes/get-data) |  | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [get-image](https://source.cloud.google.com/spark-eyes/get-image) | **Cabeçote**. Serviço que monitora o cache Redis interno para identificar uma requisição de imagem, fazendo então a consulta ao cache de imagens no próprio Redis, enviando a imagem para processamento e retornando ao Redis.<br><br> | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [get-result](https://source.cloud.google.com/spark-eyes/get-result) | Serviço que monitora o cache Redis interno para identificar uma requisição de resultado final da peça, fazendo então a consulta do resultado ao banco de dados e retornando ao Redis. Análogo ao `get-image`<br><br> | Python | To Do | [@Arthur Henrique Mallman](#user_mention#55072352) | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [module-a](https://source.cloud.google.com/spark-eyes/module-a) | Serviço de inferência em CPU usando imagens e dados elétricos.<br><br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [module-control](https://source.cloud.google.com/spark-eyes/module-control) | Serviço cuja função é redirecionar dados a diferentes modelos com diferentes arquiteturas ( `moduleaa` , `module-b` , etc).<br><br><br><br> | Python | To Do | Matheus Gomes | Matheus Gomes |
| [plc-monitor](https://source.cloud.google.com/spark-eyes/plc-monitor) | Serviço que monitora as tags espelhadas do PLC e envia um intervalo de tempo identificado para buscar os dados correspondentes.<br><br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [plc-monitor-camera](https://source.cloud.google.com/spark-eyes/plc-monitor-camera) | **Cabeçote**. Serviço que comunica com o PLC Rockwell em Classe 1 usando a biblioteca Pylogix modificada. Lógica de handshake implementada segundo padrão definido com a GM.<br><br><br><br> | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [plc-monitor-camera-opener](https://source.cloud.google.com/spark-eyes/plc-monitor-camera-opener) | **Cabeçote**. Serviço que comunica com o PLC Rockwell em Classe 1 usando a biblioteca OpENer modificada. Lógica de handshake implementada segundo padrão definido com a GM.<br><br>Tem certificação ODVA<br><br><br>strokmatic-sdk<br><br> | C++ | To Do | Luciana | Marcus Vinícius |
| [plc-result](https://source.cloud.google.com/spark-eyes/plc-result) | Serviço que comunica com o PLC Rockwell em Classe 1 usando a biblioteca Pylogix modificada. Lógica de handshake implementada segundo padrão definido com a GM. Análogo ao `plc-monitor-camera`<br><br><br><br> | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [processing-image](https://source.cloud.google.com/spark-eyes/processing-image) | **Cabeçote**. Serviço que realiza o pré-processamento das imagens capturadas, em relação ao crop correto da região onde está o ponto de solda.<br><br> | Python | To Do | Matheus Gomes | Matheus Gomes |
| [setup](https://source.cloud.google.com/spark-eyes/setup) | Conjunto de scripts para configuração do sistema em uma nova instalação, populando tabelas estáticas do banco de dados e no cache.<br>@Arthur Henrique Mallman<br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [sparkeyes-back-end](https://source.cloud.google.com/spark-eyes/sparkeyes-back-end) | Backend do Spot Fusion. | NestJS | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [sparkeyes-front-end](https://source.cloud.google.com/spark-eyes/sparkeyes-front-end) | Frontend do Spot Fusion | Angular | To Do | Felipe Teixeira | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [sparkeyes-back-end-vision-module](https://source.cloud.google.com/spark-eyes/sparkeyes-back-end-vision-module) | Backend de interface gráfica para configuração do cabeçote.<br><br> | NestJS | To Do | Gabrieli Barbosa | Gabrieli Barbosa |
| [sparkeyes-front-end-vision-module](https://source.cloud.google.com/spark-eyes/sparkeyes-front-end-vision-module) | Frontend de interface gráfica para configuração do cabeçote.<br><br> | Angular | To Do | Gabrieli Barbosa | Gabrieli Barbosa |
| [sparkeyes-hash](https://source.cloud.google.com/spark-eyes/sparkeyes-hash) | Hash do código fonte registrado no INPI | hash | To Do | Matheus Gomes | Matheus Gomes |
| [sparkeyes-server-installer](https://source.cloud.google.com/spark-eyes/sparkeyes-server-installer) | Script de instalação completa do Spot Fusion no Server<br><br> | SH | To Do | Matheus Gomes | Matheus Gomes |
| [sparkeyes-sqls](https://source.cloud.google.com/spark-eyes/sparkeyes-sqls) | Coletânea de schemas, funções e triggers do banco de dados<br>@Arthur Henrique Mallman<br><br> | SQL | To Do | [@Arthur Henrique Mallman](#user_mention#55072352) | [@Arthur Henrique Mallman](#user_mention#55072352) |
| sparkeyes-toolkit | Coletânea de ferramentas de interação e suporte ao sistema Spot Fusion, dockerizadas e em forma de apps streamlit.<br><br> | Python | To Do | [@Pedro Teruel](#user_mention#3148447) |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
| [Ibroker](https://source.cloud.google.com/spark-eyes/Ibroker) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Icache](https://source.cloud.google.com/spark-eyes/Icache) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Icontroler](https://source.cloud.google.com/spark-eyes/Icontroler) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Idatabase](https://source.cloud.google.com/spark-eyes/Idatabase) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Iesp](https://source.cloud.google.com/spark-eyes/Iesp) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Iimage](https://source.cloud.google.com/spark-eyes/Iimage) | **Submódulo**. | Python | To Do | Matheus Gomes | Matheus Gomes |
| [Ilog](https://source.cloud.google.com/spark-eyes/Ilog) | **Submódulo**. | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [Ineural](https://source.cloud.google.com/spark-eyes/Ineural) | **Submódulo**. | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [Iplc](https://source.cloud.google.com/spark-eyes/Iplc) | **Submódulo**. | Python | To Do | Matheus Gomes | [@Pedro Teruel](#user_mention#3148447) |
| [Iwtc](https://source.cloud.google.com/spark-eyes/Iwtc) | **Submódulo**. Implementação de um wrapper python para usar a API do WTC View-R, para consulta de dados de soldagem.<br><br><br>strokmatic-sdk<br><br> | Python | To Do | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [pylogix](https://source.cloud.google.com/spark-eyes/pylogix) | **Submódulo**. Customização da biblioteca pylogix para comunicação em Classe 1 e Classe 2 com PLCs via EtherNet/IP<br><br><br><br>strokmatic-sdk<br><br> | Python | To Do | Matheus Gomes | Matheus Gomes |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
| [dataset-toolkit](https://source.cloud.google.com/spark-eyes/dataset-toolkit) | **Data Science**. Ferramentas internas de tratamento de dados de testes. Avaliar unificação com rotinas atualmente usadas pela equipe de Data Science. | Python | To Do | [@Pedro Teruel](#user_mention#3148447) | [@Pedro Teruel](#user_mention#3148447) |
| [data-scraping](https://source.cloud.google.com/spark-eyes/data-scraping) | **Lab**. Ferramenta interna que interage com a interface HTML do controlador WTC. Definir melhor as funcionalidades. | Python | ??? | Gustavo Camargo | Gustavo Camargo |
| [database-cleanup](https://source.cloud.google.com/spark-eyes/database-cleanup) | [@Arthur Henrique Mallman](#user_mention#55072352) Descrever esse repo. | SH | ??? | [@Arthur Henrique Mallman](#user_mention#55072352) | [@Arthur Henrique Mallman](#user_mention#55072352) |
| [processing-image-lab](https://source.cloud.google.com/spark-eyes/processing-image-lab) | Cabeçote. [@Arthur Henrique Mallman](#user_mention#55072352) não sei a diferença desse para o original. Vc sabe? | Python | ??? | Matheus Gomes | Matheus Gomes |
|  |  |  | ??? |  |  |
|  |  |  | ??? |  |  |
|  |  |  | ??? |  |  |
|  |  |  | ??? |  |  |
| [acquisition-sjc](https://source.cloud.google.com/spark-eyes/acquisition-sjc) | Fork adaptado para Windows, consolidando diversos serviços em um só. Descontinuado. | Python | Descontinuado | Matheus Gomes | Matheus Gomes |
| [Iprocessing](https://source.cloud.google.com/spark-eyes/Iprocessing) | **Submódulo**. Implementa préprocessamento de dados, função agora integrada ao `Ineural` . Descontinuado. | Python | Descontinuado | Matheus Gomes | Matheus Gomes |
| [processing-data](https://source.cloud.google.com/spark-eyes/processing-data) | Serviço de pré-processamento dos dados elétricos para inferência. Funcionalidade integrada no `default-module` por meio do submódulo `Ineural` . Descontinuado. | Python | Descontinuado | Matheus Gomes | [@Arthur Henrique Mallman](#user_mention#55072352) |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | \- |  |  |
| [sparkeyes](https://source.cloud.google.com/spark-eyes/sparkeyes) | Repositório centralizado antes da divisão em um repositório para cada serviço. | Python | Descontinuado | Matheus Gomes | Manoel Morais |
| [processing-modules-image](https://source.cloud.google.com/spark-eyes/processing-modules-image) | Repositório quase vazio. | Python | Descontinuado | Matheus Gomes | Matheus Gomes |
| [message-broker-interface](https://source.cloud.google.com/spark-eyes/message-broker-interface) | Repositório quase vazio. | Python | Descontinuado | Matheus Gomes | Matheus Gomes |
| [IESparkEyes](https://source.cloud.google.com/spark-eyes/IESparkEyes) | Repositório vazio. | \- | \- | \- | \- |

### Smart Die

| **Repositório** | **Descrição** | **Linguagem** | **Migração GitHub** | **Desenvolvedor** | **Último a editar** |
| ---| ---| ---| ---| ---| --- |
| [smartdie-frontend](https://github.com/strokmatic/smartdie-front-end) |  | Angular | OK |  | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [smartdie-backend](https://github.com/strokmatic/smartdie-back-end) |  | NestJS | OK |  | [@Guilherme Teixeira Santos](#user_mention#87301649) |
| [smartdie-firmware-hub](https://github.com/strokmatic/smartdie-firmware-hub) |  | C | OK | Marcus Vinicius | [@Pedro Teruel](#user_mention#3148447) |
| [smartdie-firmware-switch](https://github.com/strokmatic/smartdie-firmware-switch) |  | C | OK | Marcus Vinicius | [@Pedro Teruel](#user_mention#3148447) |
|  |  |  | OK |  |  |
| [smartdie-pamstamp-io](https://github.com/strokmatic/smartdie-pamstamp-io) |  | Python | OK | [@Vinicius Figueredo](#user_mention#87344642) | [@Vinicius Figueredo](#user_mention#87344642) |
|  |  |  | OK |  |  |
|  |  |  | OK |  |  |
|  |  |  | OK |  |  |
|  |  |  | OK |  |  |
|  |  |  | OK |  |  |
|  |  |  | OK |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | To Do |  |  |
|  |  |  | ??? |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | Descontinuado |  |  |
|  |  |  | \- |  |  |

## Infraestrutura e Ambientes de Teste Local
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3251](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3251))
## Estrutura de Repositórios
### Biblioteca Python
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3311](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3311))
### Biblioteca C++
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3371](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3371))
# Tutoriais
## Autenticação do GitHub via SSH
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3411](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3411))
## Migração de Repositório para GitHub
Private ([https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3231](https://app.clickup.com/3081126/docs/2y0x6-11111/2y0x6-3231))

# Infraestrutura e Ambientes de Teste Local

# Lista de Equipamentos

| **Descrição** | **Local** | **Marca** | **Modelo** | **Serial Number** | **MAC** | **IP** | **Versão do Firmware** | **Portas** | **Obs** |
| ---| ---| ---| ---| ---| ---| ---| ---| ---| --- |
| PLC Rockwell Laboratório | Laboratório | Rockwell Allen-Bradley | 1769-L18ER |  | 5C:88:16:D2:4B:57 | 192.168.15.123 | 35.011 | 80 |  |
| Módulo View-R Laboratório | Laboratório | WTC | D15530 | 23248006 | A8:A1:59:A0:CC:57 | 192.168.15.250 | 6.1.17<br>4.1.0 (API) | 80: API<br>8080: Configuração<br>38080: Licença<br>58080: Gerenciamento de Controladores |  |
| Controlador de Solda WTC6000 | Laboratório | WTC |  |  |  | 192.168.15.225 |  |  |  |
| Controlador de Solda BOS6000 | Laboratório | Bosch |  | 0x006F0BD9 | 00:30:11:16:AF:26 | 192.168.15.242 | 2.05 | 80 |  |
| Controlador de Solda BOS7000 | Laboratório | Bosch |  |  |  | 192.168.15.122 |  |  | \*em instalação |
| Driver BOS7000 | Laboratório | Bosch |  |  |  | 192.168.15.81 |  |  |  |
| Robô Colaborativo Jaka | Laboratório | Jaka |  |  | 34:00:8A:C2:82:1C | 192.168.15.200 | 2.0.1.1 | 80 |  |
| Cabeçote de Inspeção | Laboratório | Strokmatic |  |  | 00:07:32:AF:19:4B | 192.168.15.60 | \- | 22: SSH<br>4000: KeyDB |  |
| PLC Altus Driver Pinça | Laboratório | Altus | Nexto XP300 |  | 00:80:A0:05:91:42 | 192.168.15.240 | 1.14.36.4 | 80 |  |
| PLC Rockwell Maleta | Sala 1o Andar | Rockwell Allen-Bradley | 1769-L18ER |  |  | 192.168.15.121 |  |  |  |
| Câmera IR 1 | Bancada 1o Andar | Hikrobot | MV-CI003-N15 | DA4692485 | 34:BD:20:50:BE:A0 | 169.254.161.190 | V3.4.31 220527 823826 |  | \*não estão na rede<br>\*será enviada para GM SCDS |
| Câmera IR 2 | Bancada 1o Andrad | Hikrotob | MV-CI003-N15 | DA4692486 | 34:BD:20:50:BE:A1 | 169.254.162.190 | V3.4.31 220527 823826 |  | \*não estão na rede<br>\*será enviada para GM SCDS |

# Lista de PCs

| **Descrição** | **Nome** | OS | **MAC** | **IP** | **User** | **Password** | **Obs** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| Servidor central (Jarvis) | STROKMATIC | Ubuntu 22.04.4 LTS (Linux 6.5.0-44-generic) | 10:BF:48:7B:EF:36 | 192.168.15.2 | strokmatic | skm@@2022 |  |
| Workstation de treinamento | skm-training | Ubuntu 22.04.5 LTS (Linux 6.8.0-79-generic) | 08:BF:B8:9F:27:70 | 192.168.15.190 | skm | skm@@2022 | GPU RTX 4090 |
| Workstation de engenharia | DESKTOP-T5I5A5N | Windows 10 Pro 22H2<br>(OS Build 19045.6332) | 40:B0:76:47:18:24 | 192.168.15.254 | workstation | Lume2019 | GPU GTX 680<br>Licença Studio 5000<br>Licença NX<br>Software Jaka<br>Software BOS6000<br>[@Weslley Poleto](#user_mention#81507234) completar |
| Workstation de simulação | DESKTOP-SOT707C | Windows | 3C:7C:3F:7C:40:71 | 192.168.15.230 |  | skm@@2022 | Licença VisionMaster<br>Licença PAM-Stamp<br>Software Ansys Workbench Student |
| Boxer de testes Smart Die | skm-BOXER | Ubuntu 24.04.2 LTS (Linux 6.14.0-28-generic) | eno1: 00:07:32:BF:14:24<br>enp1s0: 00:07:32:BF:14:21<br>enp2s0: 00:07:32:BF:14:22<br>enp3s0: 00:07:32:BF:14:23 | eno1: 192.168.15.243<br>enp1s0: 192.168.101.1<br>enp2s0: 192.168.101.2<br>enp3s0: 192.168.100.1 | skm | skm@@2022 | \*preparar para testes internos |
| Boxer de testes Spot Fusion<br>(Hyundai) | STROKMATIC-PROD | Ubuntu 24.04.2 LTS (Linux 6.14.0-29-generic) | eno1: 00:07:32:BF:14:14<br>enp1s0: 00:07:32:BF:14:11<br>enp2s0: 00:07:32:BF:14:12<br>enp3s0: 00:07:32:BF:14:13 | eno1: 192.168.100.1<br>enp1s0: 192.168.101.1<br>enp2s0: 192.168.14.2<br>enp3s0: 192.168.15.71 | spotfusion | skm@@2022 | \*será enviada para Hyundai |
| Boxer de testes Vision King<br>(IRIS Stellantis) | visionking | Ubuntu 24.04.2 LTS (Linux 6.14.0-24-generic) | eno1: 00:07:32:C0:3E:9F<br>enp1s0: 00:07:32:C0:3E:9C<br>enp2s0: 00:07:32:C0:3E:9D<br>enp3s0: 00:07:32:C0:3E:9E | eno1: 192.168.15.232<br>enp1s0: 192.168.<br>enp2s0: 192.168.<br>enp3s0: 192.168. | strokmatic | skm@@2022 | \*preparar para testes Stellantis |
| Workstation Vision King<br>(GM SCDS) |  | Ubuntu 24.04.2 LTS<br>(Linux \_\_\_-generic) |  | 192.168.15.189 | strokmatic | skm@@2022 | \*será enviada para GM SCDS |

# Ambientes de Teste por Produto
## Vision King
### ArcelorMittal Barra Mansa

| **Instance** | **Host** | **Port** | **DB Name** | **User** | **Password** | **Visualizador** | **Nome no visualizador** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| pgsql vk01 | 192.168.15.2 | 5001 | sis-surface | strokmatic | skm@@2022 | 192.168.15.2:5050 | sis-surface-vk01 |
| pgsql vk02 | 192.168.15.2 | 5002 | sis-surface | strokmatic | skm@@2022 | 192.168.15.2:5050 | sis-surface-vk02 |
| pgsql vk03 | 192.168.15.2 | 5003 | sis-surface | strokmatic | skm@@2022 | 192.168.15.2:5050 | sis-surface-vk03 |
| pgadmin | 192.168.15.2 | 5050 | \- | [admin@strokmatic.com](mailto:admin@strokmatic.com) | skm@@2022 | \- | \- |
| keydb vk01 | 192.168.15.2 | 4001 | \- | default | SisSurface@@2022 | 192.168.15.2:5541 | redisone |
| keydb vk02 | 192.168.15.2 | 4002 | \- | default | SisSurface@@2022 | 192.168.15.2:5541 | redistwo |
| keydb vk03 | 192.168.15.2 | 4003 | \- | default | SisSurface@@2022 | 192.168.15.2:5541 | redisthree |
| redis insight | 192.168.15.2 | 5541 | \- | \- | \- | \- | \- |

## Spot Fusion
### Laboratório

| **Instance** | **Host** | **Port** | **DB Name** | **User** | **Password** | **Visualizador** | **Nome no visualizador** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| database | 192.168.15.84 | 2345 | sparkeyes | strokmatic | skm@@2022 | 192.168.15.2:5050 | Lab Server 192.168.15.84 |
| pgadmin | 192.168.15.2 | 5050 | \- | [admin@strokmatic.com](mailto:admin@strokmatic.com) | skm@@2022 | \- |  |
| redis global | 192.168.15.84 | 3000 | \- |  |  |  |  |
| redis plc | 192.168.15.84 | 2000 | \- |  |  |  |  |
| redis log | 192.168.15.84 | 3015 | \- |  |  |  |  |
| redis enrichment | 192.168.15.84 | 6000 | \- |  |  |  |  |
| redis insight |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |

## Smart Die
### Ambiente de Desenvolvimento (Boxer)

| **Instance** | **Host** | **Port** | **DB Name** | **User** | **Password** | **Visualizador** | **Nome no visualizador** |
| ---| ---| ---| ---| ---| ---| ---| --- |
| database-server | 192.168.15.243 | 2345 | smart-die | strokmatic | skm@@2022 | 192.168.15.243:5050 | smartdie |
| database-server-test | 192.168.15.243 | 2348 | smart-die | strokmatic | skm@@2022 | 192.168.15.243:5050 | smartdie-test |
| pgadmin | 192.168.15.243 | 5050 | \- | [admin@strokmatic.com](mailto:admin@strokmatic.com) | skm@@2022 | \- | \- |
| keydb cache | 192.168.15.243 | 4000 | \- | default | SmartDie@@2022 | 192.168.15.243:5540 | SmartDie |
| redis insight | 192.168.15.243 | 5540 | \- | \- | \- | \- | \- |
| rabbitmq | 192.168.15.243 | 5672 (amqp)<br>8883 (mqtt) | \- | strokmatic | SmartDie@@2022 | 192.168.15.243:15672 | \- |
|  |
|  |  |  |  |  |  |  |  |

# Ambientes de Teste por Tipo de Serviço
## Bancos de Dados
### Instâncias pgadmin

| **Instance** | **Host** | **Port** | **User** | **Password** | **pgadmin cadastrado** |
| ---| ---| ---| ---| ---| --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

### Instâncias PostgreSQL

| **Instance** | **Host** | **Port** | **User** | **Password** | **pgadmin cadastrado** |
| ---| ---| ---| ---| ---| --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

### Instâncias Redis Insight

| **Instance** | **Host** | **Port** | **User** | **Password** | **pgadmin cadastrado** |
| ---| ---| ---| ---| ---| --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

### Instâncias KeyDB

| **Instance** | **Host** | **Port** | **User** | **Password** | **pgadmin cadastrado** |
| ---| ---| ---| ---| ---| --- |
|  |  |  |  |  |  |
|  |  |  |  |  |  |

# Template - python lib

## Guia para Python: CI/CD com Artifact Registry e Cloud Build

Este guia mostra como hospedar uma biblioteca Python privada no Artifact Registry do GCP, usá-la em desenvolvimento local e automatizar a construção de uma aplicação Docker que a consome, tudo de forma segura e eficiente.

### Parte 1: Estruturar e Empacotar sua Biblioteca 📦

Primeiro, sua biblioteca Python precisa ser estruturada como um pacote instalável.
Uma estrutura mínima padrão se parece com isto:

```markdown
minha-biblioteca-customizada/
├── minha_biblioteca/
│   ├── __init__.py
│   └── helpers.py
├── pyproject.toml
└── README.md
```

Arquivo Chave (`pyproject.toml`):
Este arquivo define os metadados do seu projeto.

```powershell
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "my-custom-library"
version = "0.1.0"
# ... outros metadados
```

Você não precisará executar o comando de build manualmente, pois o Cloud Build cuidará disso.
* * *
### Parte 2: Automatizar a Publicação da Biblioteca com Cloud Build ☁️

Em vez de fazer o upload manual, você criará um pipeline de CI/CD no projeto `strokmatic-sdk` que automaticamente constrói e publica seu pacote no Artifact Registry.
Vamos usar IDs de projeto como exemplo:
*   `library-host-project`: Onde a biblioteca é armazenada e seu pipeline de CI/CD é executado. O padrão é o `strokmatic-sdk`.
*   `app-build-project`: Onde você executa o Cloud Build para construir sua aplicação. O padrão é o `strokmatic-sdk`.

#### Passo 1: Preparar o Artifact Registry e Permissões

*   Crie o Repositório Python (configuração única):

```bash
gcloud artifacts repositories create my-python-repo \
    --repository-format=python \
    --location=us-central1 \
    --project=library-host-project \
    --description="Repositório para minhas bibliotecas Python"
```

*   Conceda Permissões ao Cloud Build: A conta de serviço do Cloud Build no `library-host-project` precisa de permissão para escrever no Artifact Registry.

```bash
# Obtenha o número do projeto
PROJECT_NUMBER=$(gcloud projects describe library-host-project --format='value(projectNumber)')

# Construa o e-mail da conta de serviço
SERVICE_ACCOUNT="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Conceda o papel de Artifact Registry Writer
gcloud projects add-iam-policy-binding library-host-project \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/artifactregistry.writer"
```

#### Passo 2: Criar o `cloudbuild.yaml` para a Biblioteca

Na raiz do repositório GitHub da sua `minha-biblioteca-customizada`, crie um arquivo `cloudbuild.yaml`.

```yaml
steps:
# Passo 1: Instalar dependências de build
- name: 'python:3.11'
  entrypoint: 'pip'
  args: ['install', 'build', 'twine']

# Passo 2: Construir o pacote a partir do código-fonte
# Isso cria os arquivos .whl e .tar.gz no diretório dist/
- name: 'python:3.11'
  entrypoint: 'python'
  args: ['-m', 'build']

# Passo 3: Fazer o upload do pacote para o Artifact Registry
# A conta de serviço do Cloud Build é autenticada automaticamente
- name: 'python:3.11'
  entrypoint: 'twine'
  args:
  - 'upload'
  - '--repository-url'
  - 'https://us-central1-python.pkg.dev/library-host-project/my-python-repo/'
  - 'dist/*'

options:
logging: CLOUD_LOGGING_ONLY
```

#### Passo 3: Conectar o GitHub ao Cloud Build

Envie o arquivo `cloudbuild.yaml` para o seu repositório e, no console do GCP para o `library-host-project`, vá para Cloud Build > Acionadores. Crie um acionador que aponte para o repositório da sua biblioteca para que, a cada push, uma nova versão seja publicada automaticamente.
* * *
### Parte 3: Configuração de Desenvolvimento Local (No Repositório da sua App)

Este processo permanece o mesmo. Para usar a biblioteca localmente, configure o `pip`.
*   Faça login com o gcloud:

```bash
gcloud auth application-default login
```

*   Configure o `pip`: Adicione o repositório como um `extra-index-url` no seu arquivo `pip.conf`.

```perl
[global]
extra-index-url = https://us-central1-python.pkg.dev/library-host-project/my-python-repo/simple/
```

*   Instale o pacote no seu ambiente virtual:

```bash
pip install my-custom-library
```

* * *
### Parte 4: Configuração do Cloud Build Multi-Projeto para sua Aplicação 🐳

Este pipeline, definido no repositório da sua aplicação (`app-build-project`), buscará de forma segura a biblioteca do `library-host-project`.

#### Passo 1: Conceder Permissões IAM Multi-Projeto (Passo Crucial!)

A conta de serviço do Cloud Build do `app-build-project` precisa de acesso de leitura ao Artifact Registry no `library-host-project`.

```bash
gcloud artifacts repositories add-iam-policy-binding my-python-repo \
    --location=us-central1 \
    --project=library-host-project \
    --member="serviceAccount:SUA_CONTA_DE_SERVICO_DO_APP_BUILD" \
    --role="roles/artifactregistry.reader"
```

#### Passo 2: Configurar o `Dockerfile` da sua Aplicação

O `Dockerfile` da sua aplicação permanece o mesmo, usando um token da conta de serviço para buscar a biblioteca durante o build.

```plain
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .

# Instala o gcloud para obter um token de autenticação
RUN apt-get update && apt-get install -y google-cloud-cli

# Configura o pip e instala as dependências do Artifact Registry
RUN pip config set global.extra-index-url "https://oauth2accesstoken:$(gcloud auth print-access-token)@us-central1-python.pkg.dev/library-host-project/my-python-repo/simple/" && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]
```

#### Passo 3: Configurar o `cloudbuild.yaml` da sua Aplicação

Este arquivo constrói o contêiner final da sua aplicação.

```yaml
steps:
- name: 'gcr.io/cloud-builders/docker'
  args:
  - 'build'
  - '-t'
  - 'us-central1-docker.pkg.dev/app-build-project/my-app-repo/my-application:$COMMIT_SHA'
  - '.'images:
  - 'us-central1-docker.pkg.dev/app-build-project/my-app-repo/my-application:$COMMIT_SHA'
```

# Template - C++ lib

## Guia para C/C++: CI/CD com Conan, Artifact Registry e Cloud Build

Este é um guia análogo para configurar um fluxo de trabalho completo para dependências C/C++ usando Conan como gerenciador de pacotes e as ferramentas do GCP.

### Parte 1: Estruturar e Empacotar sua Biblioteca C/C++ com Conan ⚙️

Primeiro, você precisa definir sua biblioteca C/C++ como um pacote Conan usando uma "receita" [`conanfile.py`](http://conanfile.py).
Uma estrutura de projeto padrão usando CMake pode ser assim:

```bash
minha-lib-customizada/
├── src/
│   ├── minha_lib.cpp
│   └── CMakeLists.txt
├── include/
│   └── minha_lib/
│       └── minha_lib.h
├── CMakeLists.txt
└── conanfile.py
```

Arquivo Chave ([`conanfile.py`](http://conanfile.py)): Este script Python é a receita do seu pacote. Ele define metadados, dependências e o processo de build.

```python
from conan import ConanFile
from conan.tools.cmake import CMake, CMakeToolchain, cmake_layout

class MinhaLibCustomizadaConan(ConanFile):
    name = "my-custom-lib"
    version = "0.1.0"# Configuração do binário
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False]}
    default_options = {"shared": False, "fPIC": True}

    # Fontes estão neste repositório
    exports_sources = "CMakeLists.txt", "src/*", "include/*"def layout(self):
        cmake_layout(self)

    def generate(self):
        tc = CMakeToolchain(self)
        tc.generate()

    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()

    def package(self):
        cmake = CMake(self)
        cmake.install()

    def package_info(self):
        self.cpp_info.libs = ["my_lib"]
```

* * *
### Parte 2: Automatizar a Publicação da Biblioteca com Cloud Build ☁️

Você criará um pipeline de CI/CD no `library-host-project` para construir e publicar automaticamente seu pacote Conan.

#### Passo 1: Preparar o Artifact Registry e Permissões

*   Crie um Repositório Conan (configuração única):

```bash
gcloud artifacts repositories create my-conan-repo \
    --repository-format=conan \
    --location=us-central1 \
    --project=library-host-project \
    --description="Repositório para minhas bibliotecas C/C++"
```

1. Conceda Permissões ao Cloud Build: A conta de serviço do Cloud Build no `library-host-project` precisa de permissão para escrever no repositório Conan.

```perl
# Obtenha o número do seu projeto
PROJECT_NUMBER=$(gcloud projects describe library-host-project --format='value(projectNumber)')
SERVICE_ACCOUNT="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Conceda o papel de Artifact Registry Writer
gcloud projects add-iam-policy-binding library-host-project \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/artifactregistry.writer"
```

#### Passo 2: Criar o `cloudbuild.yaml` para a Biblioteca

Na raiz do repositório GitHub da sua `minha-lib-customizada`, crie este arquivo `cloudbuild.yaml`.

```yaml
steps:
# Passo 1: Usar um contêiner que tenha o Conan e as ferramentas de build instaladas.
- name: 'conancenter/conan-docker-tools'
  entrypoint: 'bash'
  args:
  - '-c'
  - |
    # Configura o auxiliar de credenciais do gcloud para o Conan
    gcloud artifacts conan configure --project=library-host-project

  # Adiciona o repositório do Artifact Registry como um remote do Conan
  conan remote add gcphttps://us-central1-conan.pkg.dev/library-host-project/my-conan-repo

  # Constrói o pacote. "my-user/stable" pode ser seu time/canal.
  conan create . --user=my-user --channel=stable

  # Faz o upload do pacote e sua receita para o seu remote no Artifact Registry
  conan upload 'my-custom-lib/0.1.0@my-user/stable' --all -r gcp

options:
  logging: CLOUD_LOGGING_ONLY
```

#### Passo 3: Conectar o GitHub ao Cloud Build

Configure um Acionador do Cloud Build no `library-host-project` para executar este pipeline a cada push, automatizando a publicação da sua biblioteca.
* * *

### Parte 3: Configuração de Desenvolvimento Local (No Repositório da sua App)

Para usar a biblioteca em sua máquina local, configure seu cliente Conan.
*   Faça login com o gcloud:

```bash
gcloud auth application-default login
```

*   Configure as Credenciais do Conan: Execute este comando uma vez para configurar o auxiliar de credenciais.

```bash
gcloud artifacts conan configure --project=library-host-project
```

*   Adicione o Remote: Adicione seu repositório do Artifact Registry como um remote do Conan.

```bash
conan remote add gcp https://us-central1-conan.pkg.dev/library-host-project/my-conan-repo
```

*   Consuma o Pacote: No projeto da sua aplicação, crie um `conanfile.txt` listando sua dependência.

```swift
[requires]
my-custom-lib/0.1.0@my-user/stable

[generators]
CMakeDeps
CMakeToolchain
```

1. Instale as Dependências: Execute `conan install` para baixar a biblioteca.

```bash
conan install . --output-folder=build --build=missing
```

* * *

### Parte 4: Configuração do Cloud Build Multi-Projeto para sua Aplicação 🐳

Este pipeline buscará de forma segura a biblioteca C/C++ e construirá sua aplicação final dentro de um contêiner Docker.

#### Passo 1: Conceder Permissões IAM Multi-Projeto (Passo Crucial!)

A conta de serviço do Cloud Build do `app-build-project` precisa de acesso de leitura ao repositório Conan no `library-host-project`.

```bash
gcloud artifacts repositories add-iam-policy-binding my-conan-repo \
    --location=us-central1 \
    --project=library-host-project \
    --member="serviceAccount:SUA_CONTA_DE_SERVICO_DO_APP_BUILD" \
    --role="roles/artifactregistry.reader"
```

#### Passo 2: Configurar o `Dockerfile` da sua Aplicação

Este `Dockerfile` define o ambiente para construir sua aplicação C++. \[Imagem dos logos do Docker e C++\]

```plain
# Comece com uma imagem base com compiladores
FROM ubuntu:22.04

# Instale o essencial para build, cmake, python, pip e gcloud
RUN apt-get update && apt-get install -y \
    build-essential cmake python3 python3-pip curl gnupg \
    && pip install conan \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - \
    && apt-get update -y && apt-get install -y google-cloud-cli

# Define o diretório de trabalho
WORKDIR /app

# Configura o Conan para usar o auxiliar de credenciais do gcloud e adiciona o remote
RUN gcloud artifacts conan configure --project=library-host-project && \
    conan remote add gcp https://us-central1-conan.pkg.dev/library-host-project/my-conan-repo && \
    conan profile detect --force

# Copia o arquivo de dependências primeiro para aproveitar o cache de camadas do Docker
COPY conanfile.txt .

# Instala as dependências do Artifact Registry
RUN conan install . --output-folder=build --build=missing

# Copia o restante do código-fonte da aplicação
COPY . .

# Constrói a aplicação usando CMake
RUN cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=build/conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build

# --- Estágio final para uma imagem menor ---
FROM ubuntu:22.04
WORKDIR /app
# Copia apenas a aplicação compilada do estágio de build
COPY --from=0 /app/build/my_application .
CMD ["./my_application"]
```

#### Passo 3: Configurar o `cloudbuild.yaml` da sua Aplicação

Este arquivo no repositório da sua aplicação é simples; ele apenas instrui o Cloud Build a executar seu `Dockerfile`.

```yaml
steps:
- name: 'gcr.io/cloud-builders/docker'
  args:
  - 'build'
  - '-t'
  - 'us-central1-docker.pkg.dev/app-build-project/my-app-repo/my-application:$COMMIT_SHA'
  - '.'images:- 'us-central1-docker.pkg.dev/app-build-project/my-app-repo/my-application:$COMMIT_SHA'
```

# Autenticação do Github via SSH

Aqui está um tutorial completo para gerar uma chave SSH no seu PC Ubuntu e cadastrá-la na sua conta do GitHub.
* * *
## Passo 1: Verificando Chaves SSH Existentes

Primeiro, vamos verificar se você já possui uma chave SSH em sua máquina.
1. Abra o terminal (você pode usar o atalho `Ctrl+Alt+T`).
2. Digite o seguinte comando para listar os arquivos no diretório `.ssh` (que é onde as chaves ficam guardadas):
    ```plain
    ls -al ~/.ssh
    ```
3. Procure por arquivos chamados `id_rsa.pub`, `id_ecdsa.pub` ou, de preferência, `id_ed25519.pub`.
*   Se você encontrar um desses arquivos `.pub` (chave pública), você já tem uma chave e pode pular para o Passo 3.
*   Se você não encontrar esses arquivos ou o diretório `.ssh` não existir, siga para o Passo 2.
* * *
## Passo 2: Gerando uma Nova Chave SSH

Vamos criar um novo par de chaves (pública e privada). Usaremos o algoritmo Ed25519, que é o recomendado atualmente pelo GitHub por ser moderno e seguro.
1. No terminal, cole o comando abaixo, substituindo `"`[`seu_email@exemplo.com`](mailto:seu_email@exemplo.com)`"` pelo e-mail associado à sua conta do GitHub:
    ```plain
    ssh-keygen -t ed25519 -C "seu_email@exemplo.com"
    ```
2. O terminal perguntará onde salvar a chave. Apenas pressione Enter para aceitar o local padrão (`/home/seunome/.ssh/id_ed25519`).
    ```css
    > Enter a file in which to save the key (/home/you/.ssh/id_ed25519): [Pressione Enter]
    ```
3. Em seguida, será solicitado que você crie uma passphrase (senha) para a sua chave.
    ```less
    > Enter passphrase (empty for no passphrase): [Digite uma senha e pressione Enter]
    > Enter same passphrase again: [Digite a senha novamente e pressione Enter]
    ```
4. Nota: É altamente recomendado usar uma passphrase. Ela adiciona uma camada extra de segurança. Se alguém tiver acesso ao seu computador, não conseguirá usar sua chave SSH sem saber essa senha. Você precisará digitá-la na primeira vez que usar a chave em uma sessão.
Após esses passos, sua chave pública (`id_ed25519.pub`) e sua chave privada (`id_ed25519`) estarão criadas no diretório `~/.ssh`.
* * *
## Passo 3: Adicionando sua Chave SSH ao ssh-agent

O `ssh-agent` é um programa que roda em segundo plano e gerencia suas chaves privadas, evitando que você precise digitar sua passphrase toda vez.
1. Inicie o `ssh-agent` em segundo plano:
    ```plain
    eval "$(ssh-agent -s)"
    ```
2. Adicione sua chave SSH privada ao agente (use o nome do arquivo da chave que você gerou ou já possuía):
    ```plain
    ssh-add ~/.ssh/id_ed25519
    ```
3. Se você criou uma passphrase no Passo 2, ela será solicitada agora. Digite-a para concluir.
* * *
## Passo 4: Copiando sua Chave SSH Pública

Agora, você precisa copiar o conteúdo da sua chave pública (o arquivo `.pub`) para a área de transferência.
### Método A: Usando o `xclip` (Recomendado)
1. O `xclip` é uma ferramenta que facilita copiar conteúdo do terminal. Se você não o tiver, instale-o:
    ```plain
    sudo apt install xclip
    ```
2. Use o `xclip` para copiar o conteúdo da sua chave pública:
    ```plain
    xclip -sel clip < ~/.ssh/id_ed25519.pub
    ```
3. Isso copia o conteúdo do arquivo diretamente para sua área de transferência (Ctrl+C).
### Método B: Usando o `cat` (Manual)
1. Se preferir não instalar o `xclip`, apenas exiba o conteúdo da chave no terminal:
    ```plain
    cat ~/.ssh/id_ed25519.pub
    ```
2. O terminal mostrará sua chave, algo como:
    ```plain
    ssh-ed25519 AAAAC3...[longa sequência de caracteres]... seu_email@exemplo.com
    ```
3. Selecione manualmente todo o texto da chave (de `ssh-ed25519` até o final do seu e-mail) e copie (`Ctrl+Shift+C` no terminal ou clique com o botão direito e "Copiar"). Cuidado para não adicionar linhas ou espaços extras.
* * *
## Passo 5: Adicionando a Chave SSH no GitHub

Finalmente, vamos adicionar a chave que você copiou à sua conta do GitHub.
1. Acesse o [GitHub](https://github.com/) e faça login na sua conta.
2. Clique na sua foto de perfil no canto superior direito e selecione Settings (Configurações).
3. No menu lateral esquerdo, clique em SSH and GPG keys (Chaves SSH e GPG).
4. Clique no botão verde New SSH key (Nova chave SSH).
5. No campo Title (Título), dê um nome descritivo para a chave, como "Meu Notebook Ubuntu" ou "PC do Trabalho". Isso ajuda a identificar qual máquina tem qual chave.
6. No campo Key (Chave), cole (`Ctrl+V`) a chave pública que você copiou no Passo 4.
7. Clique em Add SSH key (Adicionar chave SSH). Você talvez precise confirmar sua senha do GitHub.
* * *
## Passo 6: Testando a Conexão

Para garantir que tudo funcionou, você pode testar a conexão SSH com o GitHub.
1. Volte ao seu terminal e digite:
    ```plain
    ssh -T git@github.com
    ```
2. Na primeira vez que você se conectar, poderá ver um aviso de autenticidade:
    ```markdown
    > The authenticity of host 'github.com (140.82.121.4)' can't be established.
    > ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
    > Are you sure you want to continue connecting (yes/no/[fingerprint])?
    ```
3. Digite yes e pressione Enter.
4. Se tudo deu certo, você verá uma mensagem de boas-vindas:
    ```markdown
    > Hi seunomedeusuario! You've successfully authenticated, but GitHub does not
    > provide shell access.
    ```
Pronto! Sua máquina Ubuntu está autenticada com o GitHub usando SSH. Agora você pode clonar, dar `push` e `pull` em seus repositórios sem precisar digitar seu usuário e senha.

# Migração de Repositório do Google Source Repositories para o GitHub

# Migração do Código
## 1\. Criar o repositório vazio no GitHub
*   Padrão de nome: `nomedoprojeto-nome-do-repositorio`
*   Não adicionar descrição
*   Não adicionar README
*   O repositório deve ser criado completamente vazio e sem rulesets, conforme imagem abaixo
![](https://t3081126.p.clickup-attachments.com/t3081126/0988eb22-fc66-4c55-9a88-447bd7509ad7/image.png)
## 2\. Clonar o repositório antigo e atualizar todas as branches no local
*   Após clonar o repositório localmente, fazer checkout para cada branch `origin/*` para garantir que ele esteja também presente localmente e com todos os commits atualizados

Exemplo: Branch remoto `origin/sahi` não estava presente localmente
![](https://t3081126.p.clickup-attachments.com/t3081126/a2922167-dae8-4fb9-9ef0-aa03d680c539/image.png)
Exemplo: Após checkout, branch `sahi` aparece também localmente
![](https://t3081126.p.clickup-attachments.com/t3081126/119a65e5-0ee0-448a-ab3e-80668dbbc5c4/image.png)

Todas as branches que estiverem apenas no `origin` e não no local **não serão publicadas no novo repositório!**

Após todos os branches listados em `branches remotos` estarem também na lista `branches` (sem `origin/` na frente), pode seguir para o próximo passo.

## 3\. Adicionar nova remota ligando o repositório local ao novo repositório do GitHub
*   Comandos para adicionar o novo repositório como um novo origin chamado `github` ao repositório clonado localmente

```elixir
# Add the new GitHub remote
git remote add github git@github.com:strokmatic/nomedoprojeto-nome-do-repositorio.git
```

## 4\. Realizar o push de todos os branches e tags locais para o novo repositório, inclusive histórico de commits antigos

```haskell
# Push all branches
git push github --all --force

# Push all tags
git push github --tags --force
```

![](https://t3081126.p.clickup-attachments.com/t3081126/8feccf94-8218-4292-a234-cc75f308355b/image.png)
## 5\. Verificar no repositório online se todo o código foi publicado
![](https://t3081126.p.clickup-attachments.com/t3081126/751b0f9b-10ce-43ca-bf0c-27872050acb8/image.png)
## 6\. Realizar novo `git clone` diretamente do novo repositório
![](https://t3081126.p.clickup-attachments.com/t3081126/06bbf7eb-9907-49a2-8cf3-7f399c865eda/image.png)

**Pronto, seu novo repositório está pronto para o uso!**

#   

# Configuração do Cloud Build para novo repositório
## 1\. Conectar o repositório GitHub ao GCP Cloud Build

*   No menu principal do Cloud Build, vá em **Repositórios**
![](https://t3081126.p.clickup-attachments.com/t3081126/d00883eb-0ccd-441d-94c6-789c332bb590/image.png)
*   Vá em **Conectar repositório**
![](https://t3081126.p.clickup-attachments.com/t3081126/a5da86d1-a67c-4104-825c-a68befc01990/image.png)
*   No assistente de conexão, selecione **GitHub (app GitHub do Cloud Build)**
![](https://t3081126.p.clickup-attachments.com/t3081126/c9030960-d077-48df-aed7-a298662579fb/image.png)
*   Selecione o repositório desejado na lista
![](https://t3081126.p.clickup-attachments.com/t3081126/1e04d0e5-e2bd-4335-86df-a8e9e2bdbb3a/image.png)
*   Por fim, clique em **Concluído**. O gatilho será criado de outra forma.
![](https://t3081126.p.clickup-attachments.com/t3081126/d9f03f76-59b9-4f06-a32e-814401e6372c/image.png)
## 2\. Criar Gatilho para o novo repositório

*   No menu, vá em **Gatilhos**
![](https://t3081126.p.clickup-attachments.com/t3081126/0a85f49d-329b-4905-ab96-5f6f8ecb4422/image.png)
*   Localize o gatilho do repositório antigo, e selecione **Duplicar**
![](https://t3081126.p.clickup-attachments.com/t3081126/aa03c3de-3ceb-4374-a1db-dc56655e2343/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/6436efb9-5767-476e-a200-1832b7f08941/image.png)
*   Selecione a cópia do gatilho e vá em **Editar**
![](https://t3081126.p.clickup-attachments.com/t3081126/390009a5-0d8b-4ac6-8ae5-092405de7d7d/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/3f33db0c-72d1-4f46-a693-20cab9e863ec/image.png)
*   Ajuste o nome do Gatilho, a Descrição, selecione o novo repositório, e vá em **Salvar**
![](https://t3081126.p.clickup-attachments.com/t3081126/82210763-a63f-4d33-ada6-92c3230a0bc9/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/b8cca034-9d86-4a2b-87cb-241055ab7617/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/d42e2fb0-5fd0-42ec-9c80-ddd5c7f4a6be/image.png)
*   Confirme as informações após salvar o Gatilho editado
![](https://t3081126.p.clickup-attachments.com/t3081126/b271ee7c-ef5a-427b-8b3f-2dff13b054ed/image.png)
*   Execute o Gatilho manualmente para testar sua configuração

**Caso não tenha havido nenhuma edição no código do repositório, o build será salvo no mesmo repositório do Artifact Registry, com o nome do container antigo (nesse exemplo,** **`ca-sis-surface`****).**

**Caso o código seja editado para substituir todas as referências pelo novo nome (recomendado), o build de teste será a primeira versão com o novo nome (nesse exemplo,** **`visionking-camera-acquisition`****).**

*   Clique em **Executar**
![](https://t3081126.p.clickup-attachments.com/t3081126/f077a0d4-749f-4f59-92d9-7a161e9b4e1d/image.png)
*   Confirme a branch correta e clique em **Executar gatilho**
![](https://t3081126.p.clickup-attachments.com/t3081126/326dda74-2252-4513-b959-e59582147eb4/image.png)
*   Vá em **Histórico** e aprove o novo build em **Aprovar**
![](https://t3081126.p.clickup-attachments.com/t3081126/2c553ea6-245d-4a8c-ae7a-39474a8bb3ed/image.png)
*   Acompanhe sua execução para verificar se não houve erros
![](https://t3081126.p.clickup-attachments.com/t3081126/5a6d1e8f-d4a0-4dfb-b3e8-8435c3214864/image.png)

**Dica:** Veja o tempo do último build bem sucedido do Gatilho antigo para ter uma estimativa do tempo que o novo build deve levar.

![](https://t3081126.p.clickup-attachments.com/t3081126/53b2f832-1f90-4b99-bff0-ef356a22a6d8/image.png)
## 3\. Verificar configuração do Artifact Registry

*   Após verificar o build bem sucedido, vá para o **Artifact Registry** e encontre o repositório relativo ao build recém feito
![](https://t3081126.p.clickup-attachments.com/t3081126/a6894e6e-db3c-422e-89fe-d8b9977775f3/image.png)
*   Verifique a presença de uma nova imagem recentemente adicionada
![](https://t3081126.p.clickup-attachments.com/t3081126/b06423ef-f062-44bc-963c-802d0de96fb0/image.png)
*   Adicione _tags_ manualmente, se necessário
![](https://t3081126.p.clickup-attachments.com/t3081126/f243e68a-e060-4bfa-ac41-b9d844c7f52b/image.png)
![](https://t3081126.p.clickup-attachments.com/t3081126/5ca75a33-d820-4315-93a9-81196541107f/image.png)

# Desenvolvimento com Windows

# Instalação WSL e Ubuntu 24.04
* * *
## Pré-requisitos

Antes de começar, garanta que seu sistema atende a estes dois requisitos básicos:
1. Versão do Windows: Você precisa ter o Windows 10 versão 2004 ou superior (Build 19041+) ou qualquer versão do Windows 11. Para verificar, pressione `Win + R`, digite `winver` e pressione Enter.
2. Virtualização Habilitada: A virtualização de hardware precisa estar ativada na BIOS/UEFI do seu computador. A maioria dos computadores modernos já vem com isso ativado.
* * *
## Passo 1: Abrir o PowerShell como Administrador

A maneira mais fácil de instalar tudo é usando um único comando no terminal.
1. Clique no Menu Iniciar ou pressione a tecla Windows.
2. Digite `PowerShell`.
3. Nos resultados da busca, clique com o botão direito em Windows PowerShell e selecione a opção Executar como administrador.
4. Uma janela de confirmação (Controle de Conta de Usuário) aparecerá. Clique em Sim.
* * *
## Passo 2: Instalar o WSL e o Ubuntu

Com o PowerShell de administrador aberto, você só precisa de um comando. Digite o seguinte comando e pressione Enter:
PowerShell

```haskell
wsl --install
```

Este único comando fará tudo automaticamente para você:
*   ✅ Habilita os recursos necessários do Windows, como a "Plataforma de Máquina Virtual" e o "Subsistema do Windows para Linux".
*   ✅ Baixa e instala a versão mais recente do kernel Linux.
*   ✅ Define o WSL 2 como padrão, que é a versão mais moderna e com melhor desempenho.
*   ✅ Baixa e instala a distribuição Ubuntu (por padrão, ele pega a versão LTS mais recente, que atualmente é a 24.04).
O processo de download e instalação pode demorar alguns minutos, dependendo da sua conexão com a internet.
* * *
## Passo 3: Reiniciar o Computador

Quando o comando terminar, ele solicitará que você reinicie o seu computador para que todas as alterações e ativações de recursos sejam concluídas. Salve qualquer trabalho que estiver aberto e reinicie a máquina.
Este passo é obrigatório.
* * *
## Passo 4: Configurar o Ubuntu

Após o computador reiniciar, o processo de instalação do Ubuntu continuará automaticamente.
1. Uma janela de terminal do Ubuntu se abrirá sozinha. Aguarde um momento enquanto ele finaliza a instalação ("Installing, this may take a few minutes...").
2. Em seguida, você será solicitado a criar um nome de usuário (UNIX username). Este será o seu usuário dentro do ambiente Linux. Pode ser diferente do seu usuário do Windows. Digite um nome de usuário (em letras minúsculas e sem espaços é o ideal) e pressione Enter.
3. Depois, você precisará criar uma senha (password) para esse usuário. Ao digitar, nada aparecerá na tela. Isso é uma medida de segurança normal no Linux. Digite a senha com cuidado e pressione Enter.
4. Você precisará confirmar a senha. Digite-a novamente e pressione Enter.
Pronto! Se tudo deu certo, você verá uma mensagem de boas-vindas e o prompt de comando do seu novo ambiente Ubuntu. 🐧
* * *
## Passo 5: Atualizar o seu Ubuntu

É uma excelente prática sempre atualizar os pacotes da sua nova instalação Linux para garantir que tudo está na versão mais recente e segura.
No terminal do Ubuntu que já está aberto, digite os seguintes comandos, um de cada vez:
1. Primeiro, para atualizar a lista de pacotes disponíveis:
    ```bash
    sudo apt update
    ```
2. Será solicitada a senha que você acabou de criar. Digite-a e pressione Enter.
3. Depois, para de fato atualizar os pacotes instalados:
    ```plain
    sudo apt upgrade
    ```
4. Ele mostrará uma lista de pacotes a serem atualizados e perguntará se você quer continuar. Digite `S` (de "sim") e pressione Enter.
Aguarde a conclusão do processo. Agora seu sistema está totalmente instalado e atualizado!
* * *
## Como Usar e Dicas Adicionais

*   Como abrir o Ubuntu: Para abrir seu ambiente Linux a qualquer momento, basta ir ao Menu Iniciar e procurar por Ubuntu. Você também pode abrir o PowerShell ou o Prompt de Comando e simplesmente digitar `wsl` e pressionar Enter.
*   Windows Terminal: Recomendo fortemente instalar o Windows Terminal da Microsoft Store. É um aplicativo moderno que permite gerenciar o PowerShell, o CMD e suas distribuições WSL (como o Ubuntu) em abas, tornando a experiência muito melhor.
*   Acessar arquivos do Windows: Seus drives do Windows são montados automaticamente dentro do Ubuntu. Você pode acessá-los no diretório `/mnt/`. Por exemplo, o seu `C:\` está em `/mnt/c/`.
*   Acessar arquivos do Linux: Para ver os arquivos do seu Ubuntu a partir do Windows Explorer, basta digitar `\\wsl$` na barra de endereço do Explorer e pressionar Enter.
* * *
# Configuração Docker Desktop
* * *
## Pré-requisitos

1. WSL 2 Instalado: Você precisa ter o WSL com o Ubuntu 24.04 (ou outra distro) já instalado e funcionando, como fizemos no tutorial anterior. O Docker Desktop requer o WSL 2, e o comando `wsl --install` já o configura como padrão.
2. Virtualização Habilitada: Já deve estar ativa do passo anterior, mas é um requisito fundamental para o Docker também.
* * *

## Passo 1: Baixar e Instalar o Docker Desktop

Primeiro, precisamos instalar o aplicativo do Docker no Windows. Ele será o "cérebro" que gerenciará seus contêineres, enquanto o Ubuntu no WSL será o ambiente onde os comandos são executados.
1. Acesse o site oficial do Docker:
    [
    www.docker.com
    https://www.docker.com/products/docker-desktop/
    ](https://www.docker.com/products/docker-desktop/)
2. Clique no botão de download para Windows. Será baixado um arquivo `Docker Desktop Installer.exe`.
3. Execute o instalador que você baixou.
4. Durante a instalação, uma tela de configuração aparecerá. Garanta que a opção "Use WSL 2 instead of Hyper-V (recommended)" esteja marcada. Normalmente, ela já vem marcada por padrão. Deixe as outras opções como estão.
5. Clique em Ok e aguarde o término da instalação. Ao final, pode ser necessário reiniciar o seu computador.
* * *
## Passo 2: Habilitar a Integração com o Ubuntu no WSL

Agora vem o passo mais importante: dizer ao Docker Desktop para usar sua instalação do Ubuntu 24.04.
1. Após a instalação (e a reinicialização, se necessária), inicie o Docker Desktop. Você pode encontrá-lo no Menu Iniciar.
2. Um pequeno ícone de baleia 🐳 aparecerá na sua barra de tarefas (perto do relógio). Se ele estiver animado, significa que o motor do Docker está inicializando. Aguarde até que ele fique estático.
3. Clique com o botão direito no ícone da baleia e selecione Dashboard, ou simplesmente clique no ícone para abrir a janela principal.
4. No canto superior direito da janela do Docker Desktop, clique no ícone de engrenagem (Settings).
5. No menu lateral de configurações, vá para a seção Resources > WSL Integration.
6. Nesta tela, você verá duas coisas importantes:
    *   A opção "Enable integration with my default WSL distro", que deve estar ativada.
    *   Uma lista com todas as distribuições WSL que você tem instalada. Na sua lista, aparecerá o "Ubuntu-24.04".
7. Ative o interruptor ao lado de `Ubuntu-24.04`.
8. Clique no botão "Apply & Restart" no canto inferior direito para aplicar as configurações. O motor do Docker será reiniciado.
![](https://t3081126.p.clickup-attachments.com/t3081126/5cdf1579-2e57-4648-bf60-a2b4a927297b/image.png)

* * *
## Passo 3: Verificando se Tudo Funcionou

A melhor forma de confirmar que a integração foi um sucesso é rodar comandos do Docker diretamente do seu terminal do Ubuntu.
1. Abra seu terminal do Ubuntu 24.04 (pelo Menu Iniciar ou digitando `wsl` no PowerShell).
2. Primeiro, verifique se o comando `docker` está disponível. Digite:
    ```plain
    docker --version
    ```
3. Você deverá ver a versão do Docker sendo exibida, algo como `Docker version 26.1.1, build 4cf5afa`. Isso prova que o cliente Docker (CLI) foi injetado no seu ambiente Ubuntu.
4. Agora, o teste final: vamos rodar um contêiner de teste. Este comando baixa uma imagem minúscula e a executa para confirmar que tudo está funcionando de ponta a ponta.
    ```plain
    docker run hello-world
    ```
Se tudo estiver correto, você verá uma mensagem de boas-vindas do Docker:

```css
Hello from Docker!
This message shows that your installation appears to be working correctly.
...
```

Parabéns! Você conectou com sucesso o Docker Desktop ao seu ambiente Ubuntu no WSL.
* * *
## Como Tudo Funciona (e Dicas Importantes)

*   Modelo Cliente-Servidor: O que você acabou de configurar é um modelo cliente-servidor. O comando `docker` que você digita no terminal do Ubuntu é o cliente. Ele se conecta, através da integração do WSL, ao motor do Docker (daemon) que está rodando de forma otimizada no Windows, gerenciado pelo Docker Desktop.
*   NÃO instale o Docker Engine no Ubuntu: Um erro comum é tentar instalar o Docker dentro do Ubuntu usando `sudo apt-get install` [`docker.io`](http://docker.io). Não faça isso! O Docker Desktop já cuida de tudo. Ter duas instalações do Docker pode causar conflitos.
*   Montando Volumes: A grande vantagem é que agora você pode rodar contêineres e "montar" (disponibilizar) pastas tanto do seu sistema de arquivos do Windows quanto do Linux.
    *   Para montar uma pasta do Windows: `docker run -v /mnt/c/Users/SeuUsuario/projetos:/app minha-imagem`
    *   Para montar uma pasta do Linux (Ubuntu): `docker run -v ~/meu-projeto-ubuntu:/app minha-imagem`
*   Integração com VS Code: Se você usa o Visual Studio Code, instale a extensão "Dev Containers". Ela permite que você abra pastas do seu projeto diretamente dentro de contêineres Docker, criando um ambiente de desenvolvimento perfeitamente isolado e replicável. É a combinação perfeita com o WSL e o Docker Desktop.

* * *
# Cadastrar chave SSH do Ubuntu no Github
* * *
## O que é uma chave SSH?

Pense nela como uma fechadura digital. Você gera um par de chaves:
1. Chave Privada (`id_ed25519`): Fica guardada secretamente no seu computador (no Ubuntu/WSL). É a sua chave pessoal, nunca a compartilhe.
2. Chave Pública (`id_ed25519.pub`): Você pode compartilhar livremente. Ela funciona como o "cadeado". Você a instala em serviços como o GitHub.
Quando você tenta se conectar, o GitHub usa a chave pública (o cadeado) para verificar a autenticidade da sua chave privada (a chave), garantindo que é realmente você.
* * *
## Passo 1: Abrir o Terminal do Ubuntu

Inicie o seu ambiente WSL. Vá ao Menu Iniciar e abra o Ubuntu 24.04.

* * *
## Passo 2: Gerar o Par de Chaves SSH

Agora, vamos criar as chaves.
1. Copie e cole o comando abaixo no seu terminal. Substitua [`seu_email@exemplo.com`](mailto:seu_email@exemplo.com) pelo mesmo endereço de e-mail que você usa na sua conta do GitHub.
    ```plain
    ssh-keygen -t ed25519 -C "seu_email@exemplo.com"
    ```
    *   Por que `ed25519`? É o algoritmo de criptografia mais recomendado atualmente, por ser seguro e rápido.
2. O terminal fará algumas perguntas:
    *   `Enter a file in which to save the key (...)`: Apenas pressione Enter para aceitar o local padrão. Ele salvará a chave na pasta correta.
    *   `Enter passphrase (empty for no passphrase):`: Aqui você pode criar uma senha para a sua chave SSH.
        *   Recomendado: Digite uma senha segura. Ela será solicitada sempre que você usar a chave, adicionando uma camada extra de proteção caso alguém acesse seu computador.
        *   Opcional: Se não quiser uma senha, apenas pressione Enter duas vezes (uma para a senha e outra para a confirmação).
Ao final, ele mostrará uma "arte" com a imagem da sua chave e confirmará que ela foi salva.
![](https://t3081126.p.clickup-attachments.com/t3081126/11e457ba-d67f-41ff-b2aa-c0c4d8c2498e/image.png)
* * *
## Passo 3: Iniciar o Agente SSH e Adicionar sua Chave

O "agente" SSH é um programa que roda em segundo plano e gerencia suas chaves privadas para que você não precise digitar a senha (passphrase) a cada conexão.
1. Inicie o agente com o seguinte comando:
    ```plain
    eval "$(ssh-agent -s)"
    ```
2. Ele deve responder com algo como `Agent pid 123`.
3. Agora, adicione sua nova chave privada ao agente:
    ```plain
    ssh-add ~/.ssh/id_ed25519
    ```
    *   Se você criou uma senha (passphrase) no passo anterior, ela será solicitada agora. Digite-a e pressione Enter.
    *   Você deve receber a confirmação: `Identity added: ...`
![](https://t3081126.p.clickup-attachments.com/t3081126/fe547ec3-311f-4771-9fa0-caad1a678f99/image.png)
* * *
## Passo 4: Copiar sua Chave Pública

Agora precisamos pegar o conteúdo da sua chave pública (o "cadeado") para colocá-la no GitHub.
1. Use o comando abaixo para exibir o conteúdo do arquivo da chave pública no terminal:
    ```plain
    cat ~/.ssh/id_ed25519.pub
    ```
2. O terminal mostrará sua chave, que começa com `ssh-ed25519`, seguido por uma longa sequência de caracteres, e termina com o seu e-mail.
3. Selecione e copie TODO o texto, do início (`ssh-ed25519`) ao fim (seu e-mail). Cuidado para não adicionar espaços ou quebras de linha extras.
* * *
## Passo 5: Adicionar a Chave SSH no GitHub

Com a chave copiada, vamos para o site do GitHub.
1. Abra seu navegador, acesse [github.com](https://github.com/) e faça login na sua conta.
2. Clique na sua foto de perfil no canto superior direito e, no menu, selecione Settings.
    ![](https://t3081126.p.clickup-attachments.com/t3081126/d01ef32d-2ebc-464f-b1ef-a75de88cb84a/image.png)
3. No menu de configurações à esquerda, clique em SSH and GPG keys.
    ![](https://t3081126.p.clickup-attachments.com/t3081126/a063198a-b550-46ae-b827-8259486f2c67/image.png)
4. Clique no botão verde New SSH key.
5. Um formulário aparecerá:
    *   Title: Dê um nome descritivo para a chave, que ajude você a lembrar de onde ela veio. Por exemplo: `Notebook Dell WSL` ou `Ubuntu 24.04 Desktop`.
    *   Key type: Deixe como `Authentication Key`.
    *   Key: Cole a chave pública que você copiou do terminal neste campo.
6. Clique em Add SSH key. O GitHub pode pedir sua senha para confirmar a ação.
![](https://t3081126.p.clickup-attachments.com/t3081126/149d416e-1f37-46ae-bbb1-9a24e43203a9/image.png)
* * *
## Passo 6: Testar a Conexão

Vamos voltar ao terminal do Ubuntu para fazer o teste final e garantir que tudo está funcionando.
1. Digite o seguinte comando:
    ```plain
    ssh -T git@github.com
    ```
2. Na primeira vez que você se conectar, verá um aviso de autenticidade do host, algo como:
3. The authenticity of host '[github.com](http://github.com) (....)' can't be established.
4. Are you sure you want to continue connecting (yes/no/\[fingerprint\])?
5. Isso é normal. Digite yes e pressione Enter.
6. Se tudo deu certo, você receberá uma mensagem de boas-vindas do GitHub:
7. Hi _seu-username_! You've successfully authenticated, but GitHub does not provide shell access.
Pronto! Sua conexão está configurada. Agora, ao clonar repositórios, use a opção "SSH" em vez de "HTTPS". E o mais importante: você nunca mais precisará digitar seu nome de usuário e senha para `git push`, `pull` ou `fetch`.

![](https://t3081126.p.clickup-attachments.com/t3081126/78e79239-ffc4-4d89-a95a-796a5c4e0fa1/image.png)

![](https://t3081126.p.clickup-attachments.com/t3081126/31665a21-0389-4bb3-b938-b7660237cfa8/image.png)

![](https://t3081126.p.clickup-attachments.com/t3081126/09bd381c-0656-4487-a0b2-42d58b28a3dd/image.png)

# Data Science

