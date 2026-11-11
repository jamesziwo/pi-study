> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/skills/interactive-testing.md` · [英文原文](../../../../.pi/skills/interactive-testing.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`65264173c8d5352b9ad643dd524238da0537572aeed9c1d754017ca8907c9673`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: interactive-testing
description: Test and debug pi's interactive mode in a controlled tmux terminal. Use for TUI behavior checks and interactive release smoke tests.
---
```


<a id="testing-pi-interactive-mode-with-tmux"></a>
# 使用 tmux 测试 pi 交互模式

在受控终端运行 TUI，命令从仓库根目录执行，即原始 skill 上方两级目录：

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p     # capture after startup
tmux send-keys -t pi-test "your prompt here" Enter
tmux send-keys -t pi-test Escape               # special keys (also C-o for ctrl+o, etc.)
tmux kill-session -t pi-test
```

发布冒烟测试用 `-c /tmp` 启动 tmux，并用发布二进制的绝对路径替换 `./pi-test.sh`。分别测试 Node、Bun，提交提示并等待模型回复；仅启动成功不算冒烟通过。
