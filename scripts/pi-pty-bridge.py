#!/usr/bin/env python3
"""Dependency-free Unix PTY adapter for the Pi editor terminal.

The adapter preserves terminal semantics while stdin/stdout are pipes, turns
file-drop payloads into Pi mentions, and compacts Pi's OSC terminal title.
The TypeScript launcher detects support and falls back cleanly elsewhere.
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import tty
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

DEFAULT_TITLE = "Pi Coding Agent"
DEFAULT_TITLE_MAX_LENGTH = 24
MAX_PENDING_OSC_BYTES = 8_192
READ_SIZE = 65_536

BRACKETED_PASTE = re.compile(r"^\x1b\[200~(.*?)\x1b\[201~\r?\n?$", re.DOTALL)
MENTION_REQUIRES_QUOTES = re.compile(r'''[\s"'`]''')
WINDOWS_ABSOLUTE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
OSC_START = b"\x1b]"
OSC_BEL = b"\x07"
OSC_ST = b"\x1b\\"


@dataclass(frozen=True)
class Options:
    cwd: str | None
    columns: int
    rows: int
    control_fd: int | None
    title_max_length: int
    rewrite_input_only: bool
    rewrite_output_only: bool
    command: list[str]


def main(argv: list[str]) -> int:
    options = parse_options(argv[1:])
    if options.rewrite_input_only:
        sys.stdout.buffer.write(rewrite_input(sys.stdin.buffer.read(), options.cwd))
        return 0
    if options.rewrite_output_only:
        transformer = OscTitleTransformer(options.title_max_length)
        sys.stdout.buffer.write(transformer.feed(sys.stdin.buffer.read()))
        sys.stdout.buffer.write(transformer.flush())
        return 0
    if not options.command:
        print("pi-pty-bridge: missing command after --", file=sys.stderr)
        return 2
    return PtyRelay(options).run()


def parse_options(argv: list[str]) -> Options:
    parser = argparse.ArgumentParser(prog="pi-pty-bridge")
    parser.add_argument("--cwd")
    parser.add_argument("--columns", type=positive_integer, default=80)
    parser.add_argument("--rows", type=positive_integer, default=24)
    parser.add_argument("--control-fd", type=int)
    parser.add_argument(
        "--title-max-length",
        type=lambda value: max(8, min(80, int(value))),
        default=DEFAULT_TITLE_MAX_LENGTH,
    )
    parser.add_argument("--rewrite-input-only", action="store_true")
    parser.add_argument("--rewrite-output-only", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    namespace = parser.parse_args(argv)
    command = namespace.command
    if command[:1] == ["--"]:
        command = command[1:]
    return Options(
        cwd=namespace.cwd,
        columns=namespace.columns,
        rows=namespace.rows,
        control_fd=namespace.control_fd,
        title_max_length=namespace.title_max_length,
        rewrite_input_only=namespace.rewrite_input_only,
        rewrite_output_only=namespace.rewrite_output_only,
        command=command,
    )


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def rewrite_input(data: bytes, cwd: str | None) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    rewritten = rewrite_dropped_paths(text, cwd)
    return rewritten.encode("utf-8") if rewritten is not None else data


def rewrite_dropped_paths(payload: str, cwd: str | None) -> str | None:
    bracketed = BRACKETED_PASTE.fullmatch(payload)
    raw = bracketed.group(1) if bracketed else payload
    paths = parse_absolute_path_list(raw)
    if not paths or not all(os.path.exists(path) for path in paths):
        return None
    mentions = format_mentions(paths, cwd)
    return mentions or None


def parse_absolute_path_list(payload: str) -> list[str] | None:
    if len(payload) < 2:
        return None
    result: list[str] = []
    cursor = 0
    while cursor < len(payload):
        cursor = skip_whitespace(payload, cursor)
        if cursor >= len(payload):
            break
        parsed = parse_path_token(payload, cursor)
        if parsed is None:
            return None
        value, cursor = parsed
        if not is_absolute_path(value):
            return None
        result.append(value)
    return result or None


def parse_path_token(payload: str, start: int) -> tuple[str, int] | None:
    if payload.startswith("$'", start):
        return parse_quoted_path(payload, start + 2, "'")
    if payload[start] in "'\"":
        return parse_quoted_path(payload, start + 1, payload[start])
    if not starts_absolute_path(payload, start):
        return None

    cursor = start + 1
    while cursor < len(payload):
        if payload[cursor].isspace():
            next_token = skip_whitespace(payload, cursor)
            if next_token >= len(payload) or starts_absolute_path(payload, next_token):
                break
        cursor += 1
    return normalize_file_uri(payload[start:cursor]), cursor


def parse_quoted_path(
    payload: str, start: int, quote: str
) -> tuple[str, int] | None:
    value: list[str] = []
    cursor = start
    while cursor < len(payload):
        character = payload[cursor]
        if character == "\\" and cursor + 1 < len(payload):
            value.append(payload[cursor + 1])
            cursor += 2
        elif character == quote:
            return normalize_file_uri("".join(value)), cursor + 1
        else:
            value.append(character)
            cursor += 1
    return None


def starts_absolute_path(payload: str, start: int) -> bool:
    candidate = payload[start:]
    return (
        candidate.startswith("/")
        or candidate.lower().startswith("file://")
        or bool(WINDOWS_ABSOLUTE_PATH.match(candidate))
    )


def is_absolute_path(value: str) -> bool:
    return value.startswith("/") or bool(WINDOWS_ABSOLUTE_PATH.match(value))


def normalize_file_uri(value: str) -> str:
    if not value.lower().startswith("file:"):
        return value
    parsed = urlparse(value)
    return unquote(parsed.path) or value.removeprefix("file://")


def skip_whitespace(payload: str, start: int) -> int:
    cursor = start
    while cursor < len(payload) and payload[cursor].isspace():
        cursor += 1
    return cursor


def format_mentions(paths: list[str], cwd: str | None) -> str:
    mentions = list(dict.fromkeys(format_mention(path, cwd) for path in paths))
    filtered = [mention for mention in mentions if mention]
    return " ".join(filtered) if filtered else ""


def format_mention(fs_path: str, cwd: str | None) -> str:
    target = mention_target(fs_path, cwd)
    if not target:
        return ""
    if MENTION_REQUIRES_QUOTES.search(target):
        return '@"' + target.replace('"', '\\"') + '"'
    return "@" + target


def mention_target(fs_path: str, cwd: str | None) -> str:
    value = fs_path.strip()
    if not value:
        return ""
    forward_slashes = value.replace("\\", "/")
    if not cwd:
        return forward_slashes
    absolute = os.path.abspath(value)
    root = os.path.abspath(cwd)
    try:
        shared = os.path.commonpath((absolute, root))
    except ValueError:
        return forward_slashes
    if shared != root:
        return forward_slashes
    relative = os.path.relpath(absolute, root)
    return relative.replace("\\", "/") if relative != "." else forward_slashes


def compact_title(raw: str, maximum_length: int) -> str:
    normalized = " ".join(raw.split())
    if len(normalized) <= maximum_length:
        return normalized
    return normalized[: maximum_length - 1] + "…"


def pi_title(raw: str, maximum_length: int) -> str | None:
    normalized = " ".join(raw.split())
    parts = normalized.split(" - ")
    if not parts or (
        parts[0] != "π" and parts[0].lower() not in ("pi", "pi coding agent")
    ):
        return None
    if len(parts) < 3:
        return DEFAULT_TITLE
    session = " - ".join(parts[1:-1]).strip()
    return compact_title(session, maximum_length) if session else DEFAULT_TITLE


class OscTitleTransformer:
    def __init__(self, maximum_length: int) -> None:
        self.maximum_length = maximum_length
        self.pending = b""

    def feed(self, data: bytes) -> bytes:
        buffer = self.pending + data
        self.pending = b""
        output = bytearray()
        cursor = 0

        while cursor < len(buffer):
            start = buffer.find(OSC_START, cursor)
            if start < 0:
                if buffer.endswith(b"\x1b"):
                    output.extend(buffer[cursor:-1])
                    self.pending = b"\x1b"
                else:
                    output.extend(buffer[cursor:])
                break
            output.extend(buffer[cursor:start])
            end, terminator_length = find_osc_end(buffer, start + len(OSC_START))
            if end < 0:
                pending = buffer[start:]
                if len(pending) <= MAX_PENDING_OSC_BYTES:
                    self.pending = pending
                else:
                    output.extend(pending)
                break
            payload = buffer[start + len(OSC_START) : end]
            output.extend(rewrite_osc_title(payload, self.maximum_length))
            cursor = end + terminator_length
        return bytes(output)

    def flush(self) -> bytes:
        pending, self.pending = self.pending, b""
        return pending


def find_osc_end(buffer: bytes, start: int) -> tuple[int, int]:
    bel = buffer.find(OSC_BEL, start)
    st = buffer.find(OSC_ST, start)
    if bel >= 0 and (st < 0 or bel <= st):
        return bel, len(OSC_BEL)
    if st >= 0:
        return st, len(OSC_ST)
    return -1, 0


def rewrite_osc_title(payload: bytes, maximum_length: int) -> bytes:
    if (
        len(payload) < 2
        or payload[:1] not in (b"0", b"1", b"2")
        or payload[1:2] != b";"
    ):
        return OSC_START + payload + OSC_BEL
    try:
        title = payload[2:].decode("utf-8")
    except UnicodeDecodeError:
        return OSC_START + payload + OSC_BEL
    rewritten = pi_title(title, maximum_length)
    if rewritten is None:
        # The bridge is dedicated to one Pi process. Suppressing unrelated
        # shell title messages keeps a login shell from renaming a fresh tab.
        return b""
    return OSC_START + b"0;" + rewritten.encode("utf-8") + OSC_BEL


class PtyRelay:
    def __init__(self, options: Options) -> None:
        self.options = options
        self.child_pid = -1
        self.master_fd = -1
        self.original_stdin_mode: list[object] | None = None
        self.transformer = OscTitleTransformer(options.title_max_length)

    def run(self) -> int:
        self.child_pid, self.master_fd = pty.fork()
        if self.child_pid == 0:
            if self.options.cwd:
                os.chdir(self.options.cwd)
            os.execvp(self.options.command[0], self.options.command)

        self._enter_raw_mode()
        self._install_signal_handlers()
        self._resize(self.options.columns, self.options.rows)
        try:
            return self._relay_until_exit()
        finally:
            self._restore_stdin_mode()
            try:
                os.close(self.master_fd)
            except OSError:
                pass

    def _relay_until_exit(self) -> int:
        stdin_fd = sys.stdin.fileno()
        stdout_fd = sys.stdout.fileno()
        control_fd = self.options.control_fd
        readable_fds = {stdin_fd, self.master_fd}
        if control_fd is not None:
            readable_fds.add(control_fd)
        resize_buffer = b""

        while True:
            try:
                ready, _, _ = select.select(list(readable_fds), [], [], 0.1)
            except OSError as error:
                if error.errno != errno.EINTR:
                    raise
                ready = []

            if stdin_fd in ready:
                data = read_fd(stdin_fd)
                if data:
                    write_all(self.master_fd, rewrite_input(data, self.options.cwd))
                else:
                    readable_fds.discard(stdin_fd)

            if self.master_fd in ready:
                data = read_fd(self.master_fd)
                if data:
                    write_all(stdout_fd, self.transformer.feed(data))
                else:
                    readable_fds.discard(self.master_fd)

            if control_fd is not None and control_fd in ready:
                data = read_fd(control_fd)
                if not data:
                    readable_fds.discard(control_fd)
                    control_fd = None
                else:
                    resize_buffer += data
                    while b"\n" in resize_buffer:
                        line, resize_buffer = resize_buffer.split(b"\n", 1)
                        self._apply_resize_line(line)

            waited, status = os.waitpid(self.child_pid, os.WNOHANG)
            if waited == self.child_pid:
                self._drain_output(stdout_fd)
                return child_exit_code(status)

    def _drain_output(self, stdout_fd: int) -> None:
        while True:
            try:
                ready, _, _ = select.select([self.master_fd], [], [], 0)
            except OSError:
                ready = []
            if not ready:
                write_all(stdout_fd, self.transformer.flush())
                return
            data = read_fd(self.master_fd)
            if not data:
                write_all(stdout_fd, self.transformer.flush())
                return
            write_all(stdout_fd, self.transformer.feed(data))

    def _apply_resize_line(self, line: bytes) -> None:
        try:
            columns, rows = (max(1, int(value)) for value in line.split())
            self._resize(columns, rows)
        except (OSError, ValueError):
            pass

    def _resize(self, columns: int, rows: int) -> None:
        packed = struct.pack("HHHH", rows, columns, 0, 0)
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, packed)
        os.kill(self.child_pid, signal.SIGWINCH)

    def _install_signal_handlers(self) -> None:
        def forward(signum: int, _frame: object) -> None:
            try:
                os.killpg(self.child_pid, signum)
            except OSError:
                pass

        signal.signal(signal.SIGTERM, forward)
        signal.signal(signal.SIGHUP, forward)

    def _enter_raw_mode(self) -> None:
        try:
            self.original_stdin_mode = termios.tcgetattr(sys.stdin.fileno())
            tty.setraw(sys.stdin.fileno())
        except termios.error:
            self.original_stdin_mode = None

    def _restore_stdin_mode(self) -> None:
        if self.original_stdin_mode is None:
            return
        try:
            termios.tcsetattr(
                sys.stdin.fileno(), termios.TCSADRAIN, self.original_stdin_mode
            )
        except termios.error:
            pass


def read_fd(fd: int) -> bytes:
    try:
        return os.read(fd, READ_SIZE)
    except OSError as error:
        if error.errno == errno.EIO:
            return b""
        raise


def write_all(fd: int, data: bytes) -> None:
    cursor = 0
    while cursor < len(data):
        cursor += os.write(fd, data[cursor:])


def child_exit_code(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
