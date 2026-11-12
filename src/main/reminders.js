'use strict';
const { readJson, writeJsonAtomic } = require('./store');
const TaskLib = require('../shared/tasks.js');

const TICK_MS = 15 * 1000;

/**
 * 到期提醒调度。运行在主进程，窗口隐藏/便笺模式下也会提醒。
 * reminded: { [taskId]: 已提醒过的 due 字符串 }。due 被修改后会再次提醒。
 */
class Reminders {
  constructor({ getState, file, onDue }) {
    this.getState = getState;
    this.file = file;
    this.onDue = onDue;
    this.reminded = readJson(file, {});
    if (!this.reminded || typeof this.reminded !== 'object') this.reminded = {};
    this.timer = null;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const state = this.getState();
    if (!state) return;
    const lead = state.settings.remindLeadMinutes * 60000;
    const now = Date.now();
    const alive = new Set();
    const fired = [];

    for (const project of state.projects) {
      TaskLib.walk(project.tasks, (task) => {
        alive.add(task.id);
        if (task.done || !task.due) return;
        const due = TaskLib.parseDue(task.due);
        if (!due || now < due.getTime() - lead) return;
        if (this.reminded[task.id] === task.due) return;
        this.reminded[task.id] = task.due;
        fired.push({ id: task.id, label: TaskLib.taskLabel(task, 60), project: project.name, due: task.due });
      });
    }

    let dirty = fired.length > 0;
    for (const id of Object.keys(this.reminded)) {
      if (!alive.has(id)) {
        delete this.reminded[id];
        dirty = true;
      }
    }
    if (dirty) {
      try {
        writeJsonAtomic(this.file, this.reminded, false);
      } catch (err) {
        console.warn('[reminders] 保存失败：', err.message);
      }
    }
    if (fired.length) this.onDue(fired);
  }
}

module.exports = { Reminders };
