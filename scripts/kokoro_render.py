"""Renders narration lines to WAV with Kokoro, a local neural TTS model.

Called by scripts/render-narration.mjs, which owns the caching and the line data. This script
just does the synthesis, and it loads the model ONCE for the whole batch — a per-line process
would spend most of its time loading weights.

Reads a JSON job from stdin: {"voice": "bm_george", "speed": 0.9, "lines": [{"id":…, "text":…}]}
Writes <id>.wav into the directory given as argv[1], and reports each one on stdout.

Why local: ElevenLabs' free tier cannot call the API and the OpenAI account has no billing, but
more to the point, a local model means editing the script is free forever instead of costing a
few cents every time. For a thing whose whole point is that the words keep getting better, that
is the difference between iterating freely and flinching at every rewrite.
"""

import json
import os
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")


def wire_up_espeak() -> None:
    """Kokoro phonemises through espeak-ng.

    The espeakng-loader wheel ships a data path baked on the CI runner that built it
    (/Users/runner/work/...), which of course does not exist on anyone else's machine. So point
    phonemizer at the Homebrew install explicitly before Kokoro imports it.
    """
    for prefix in ("/opt/homebrew/opt/espeak-ng", "/usr/local/opt/espeak-ng"):
        data = Path(prefix) / "share" / "espeak-ng-data"
        libs = sorted(Path(prefix).glob("lib/libespeak-ng*.dylib"))
        if data.is_dir() and libs:
            os.environ["ESPEAK_DATA_PATH"] = str(data)
            from phonemizer.backend.espeak.wrapper import EspeakWrapper

            EspeakWrapper.set_library(str(libs[0]))
            EspeakWrapper.set_data_path(str(data))
            return
    sys.exit("espeak-ng not found. Install it:  brew install espeak-ng")


def main() -> None:
    wire_up_espeak()

    import soundfile as sf
    from kokoro import KPipeline

    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)

    job = json.load(sys.stdin)
    voice, speed, lines = job["voice"], job.get("speed", 0.9), job["lines"]

    # First letter of the voice selects the accent model: 'a' American, 'b' British.
    pipeline = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")

    for line in lines:
        audio: list[float] = []
        for _, _, chunk in pipeline(line["text"], voice=voice, speed=speed):
            audio.extend(chunk.numpy())
        sf.write(out_dir / f"{line['id']}.wav", audio, 24000)
        print(f"{line['id']}\t{len(audio) / 24000:.1f}", flush=True)


if __name__ == "__main__":
    main()
