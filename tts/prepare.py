"""Image build step: download the model weights into /models."""

from huggingface_hub import hf_hub_download

MELO = "myshell-ai/MeloTTS-Spanish"
OPENVOICE = "myshell-ai/OpenVoiceV2"

for name in ("config.json", "checkpoint.pth"):
    hf_hub_download(MELO, name, local_dir="/models/melo")
for name in ("converter/config.json", "converter/checkpoint.pth", "base_speakers/ses/es.pth"):
    hf_hub_download(OPENVOICE, name, local_dir="/models/openvoice")
print("models downloaded")
