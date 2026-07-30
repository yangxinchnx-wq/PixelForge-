<script setup lang="ts">
interface IrChild {
  name: string
  tag: string
}

interface IrNode {
  name: string
  label?: string
  tag: string
  children?: IrChild[]
}

interface Props {
  tree: IrNode[]
}

defineProps<Props>()
</script>

<template>
  <div class="ir-tree">
    <div class="group-label">Render IR <span class="pill muted">v2</span></div>
    <div class="ir-list">
      <template v-for="node in tree" :key="node.name">
        <div class="ir-node parent">
          <span class="ir-name">{{ node.name }}</span>
          <span v-if="node.label" class="ir-label">{{ node.label }}</span>
          <span class="ir-tag layer">layer</span>
        </div>
        <div
          v-for="(child, ci) in node.children"
          :key="node.name + '-' + ci"
          class="ir-node child"
        >
          <span class="ir-name">{{ child.name }}</span>
          <span class="ir-tag region">{{ child.tag }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ir-tree {
  background: var(--glass-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.group-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  font-family: 'JetBrains Mono', monospace;
}
.pill.muted { background: var(--glass-bg-hover); color: var(--text-secondary); }

.ir-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.ir-node {
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  transition: all 160ms ease;
  cursor: pointer;
}
.ir-node:hover { background: var(--glass-bg-hover); }
.ir-node.parent { color: var(--text-primary); font-weight: 600; }
.ir-node.child { padding-left: 26px; color: var(--text-tertiary); }
.ir-name { flex-shrink: 0; }
.ir-label { color: var(--text-tertiary); font-weight: 400; }
.ir-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  margin-left: auto;
}
.ir-tag.layer { color: var(--accent); background: rgba(10, 132, 255, 0.12); }
.ir-tag.region { color: var(--text-tertiary); background: var(--track-bg); }
</style>
