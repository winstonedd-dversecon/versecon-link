#!/usr/bin/env python3
"""
Simple extractor CLI for Star Citizen data.

Modes:
- Provide an already-extracted JSON folder via `--input-json-dir` and this tool will copy
  `ships.json` and `items.json` into the versecon-link data directory.
- Optionally run as a small HTTP server to expose the produced JSON.

This is a wrapper — running the full unpack (unp4k/scunpacked) is environment-specific
and this script will attempt to call a configured command if available.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def copy_json_files(src: Path, dst: Path):
    dst.mkdir(parents=True, exist_ok=True)
    for name in ("ships.json", "items.json"):
        srcf = src / name
        if srcf.exists():
            shutil.copy2(srcf, dst / name)
            print(f"copied {srcf} -> {dst / name}")
        else:
            print(f"warning: {srcf} not found")


def run_unpacker(unpacker_cmd: str, game_dir: Path, out_dir: Path):
    """Run a configured unpacker command (user must have it installed).

    Example unpacker_cmd: "unp4k" or "python3 scunpacked/main.py"
    """
    cmd = f"{unpacker_cmd} -i \"{game_dir}\" -o \"{out_dir}\""
    print("Running unpacker:", cmd)
    try:
        subprocess.check_call(cmd, shell=True)
    except subprocess.CalledProcessError as e:
        print("unpacker failed:", e)
        sys.exit(2)


def serve_folder(folder: Path, host: str, port: int):
    try:
        from flask import Flask, send_from_directory, jsonify
    except Exception as e:
        print("Flask is required for --serve. Install with: pip install -r requirements.txt")
        sys.exit(3)

    app = Flask("extractor-server")

    @app.get("/api/ships")
    def ships():
        p = folder / "ships.json"
        if not p.exists():
            return jsonify({"error": "ships.json not found"}), 404
        return send_from_directory(folder, "ships.json")

    @app.get("/api/items")
    def items():
        p = folder / "items.json"
        if not p.exists():
            return jsonify({"error": "items.json not found"}), 404
        return send_from_directory(folder, "items.json")

    print(f"Serving {folder} on http://{host}:{port}")
    app.run(host=host, port=port)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="extractor.py")
    parser.add_argument("--input-json-dir", type=Path, help="Directory containing ships.json and items.json")
    parser.add_argument("--game-dir", type=Path, help="Path to local Star Citizen game install (for unpackers)")
    parser.add_argument("--unpacker-cmd", type=str, default="unp4k", help="Unpacker command to run (if you want extractor to run unpack)")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data", help="Where to write ships/items JSON (defaults to ship-stats/data)")
    parser.add_argument("--serve", action="store_true", help="Start a small HTTP server to expose JSON")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4000)

    args = parser.parse_args(argv)

    out = args.output_dir
    print("output dir:", out)

    if args.input_json_dir:
        print("Using provided JSON dir:", args.input_json_dir)
        copy_json_files(args.input_json_dir, out)
    elif args.game_dir:
        # attempt to run unpacker
        tmp_out = out.parent / "_extracted_tmp"
        tmp_out.mkdir(parents=True, exist_ok=True)
        run_unpacker(args.unpacker_cmd, args.game_dir, tmp_out)
        # heuristic: look for ships.json/items.json in tmp_out or its subfolders
        found = False
        for sub in [tmp_out, tmp_out / "metar", tmp_out / "data"]:
            if (sub / "ships.json").exists() or (sub / "items.json").exists():
                copy_json_files(sub, out)
                found = True
                break
        if not found:
            print("No ships.json/items.json found in unpacked output. You may need to run conversion scripts from scunpacked toolset.")
    else:
        print("Nothing to do: provide --input-json-dir or --game-dir")

    if args.serve:
        serve_folder(out, args.host, args.port)


if __name__ == "__main__":
    main()
