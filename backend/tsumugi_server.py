"""Tsumugi guitar transcription kept loaded between jobs.

Runs in Tsumugi's own environment, with its repository as working directory, and
answers one JSON request per job through engine_process.serve.  It performs the
same steps as `python -m instrument_agnostic_amt.amt.cli.infer`, but loads the
model and warms the GPU once.
"""
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, os.getcwd())

from engine_process import protocol_channel, serve  # noqa: E402


def main(checkpoint, device_name):
    channel = protocol_channel()
    from dataclasses import replace

    from instrument_agnostic_amt.amt.cli import infer
    from instrument_agnostic_amt.runtime import (is_amp_supported, maybe_compile_forward, resolve_amp_dtype,
                                                 resolve_device)

    sys.argv = ["infer", "--type", "guitar_v1_5", "--checkpoint", checkpoint, "--device", device_name,
                "--disable-tqdm", "--audio", "request.wav"]
    args = infer.parse_args()
    device = resolve_device(args.device)
    amp_dtype = resolve_amp_dtype(device, args.amp_dtype)
    amp_enabled = bool(args.amp and is_amp_supported(device))
    model, config, training_args = infer.load_model(Path(checkpoint).resolve(), device=device)
    forward_model = maybe_compile_forward(model, enabled=bool(args.compile), mode=str(args.compile_mode))
    settings = infer.resolve_inference_settings(config, training_args, args)
    settings = replace(settings, allowed_instrument_ids=infer.filter_supported_instrument_class_ids(
        args.allowed_instrument_ids, num_model_classes=int(config.num_instrument_classes)))

    def handle(request):
        infer.process_file(Path(request["audio"]), Path(request["destination"]), model=model,
                           forward_model=forward_model, config=config, instrument_id=None, settings=settings,
                           device=device, amp_enabled=amp_enabled, amp_dtype=amp_dtype, args=args)

    # First GPU inference is slow (kernels, allocator): do it now, not during a user's job.
    try:
        import numpy as np
        import soundfile

        with tempfile.TemporaryDirectory() as folder:
            silence = Path(folder) / "warm.wav"
            soundfile.write(silence, np.zeros((int(config.sample_rate) * 2, 2), dtype=np.float32),
                            int(config.sample_rate))
            handle({"audio": str(silence), "destination": str(Path(folder) / "warm.mid")})
    except Exception as error:
        print(f"Préchauffage Tsumugi impossible : {error}", file=sys.stderr, flush=True)
    serve(handle, channel)


if __name__ == "__main__":
    main(*sys.argv[1:3])
