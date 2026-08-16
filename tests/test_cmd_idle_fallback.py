"""Regression tests for idle-state fallback on /queue, /interrupt, /steer.

When the agent is idle (S.busy=false, S.activeStreamId=null), these commands
previously showed an error toast instead of sending the message. They now
fall through to a direct send() call, matching CLI behaviour:

  - /queue msg  → send when idle, queue when busy
  - /interrupt msg → send when idle, cancel+requeue when busy+streaming
  - /steer msg  → send when idle, inject mid-turn when busy+streaming
"""
import re
import pathlib


# ─────────────────────────────────────────────────────────────────────────────
# Source-level structural checks
# ─────────────────────────────────────────────────────────────────────────────
