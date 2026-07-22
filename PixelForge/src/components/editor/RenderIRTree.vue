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
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.group-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--pf-ink-faint);
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
.pill.muted { background: var(--pf-surface-soft); color: var(--pf-ink-soft); }

.ir-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.ir-node {
  padding: 6px 10px;
  border-radius: var(--pf-r-xs);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--pf-ink-soft);
  transition: all 160ms ease;
  cursor: pointer;
}
.ir-node:hover { background: var(--pf-surface-soft); }
.ir-node.parent { color: var(--pf-ink); font-weight: 600; }
.ir-node.child { padding-left: 26px; color: var(--pf-ink-muted); }
.ir-name { flex-shrink: 0; }
.ir-label { color: var(--pf-ink-muted); font-weight: 400; }
.ir-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  margin-left: auto;
}
.ir-tag.layer { color: var(--pf-accent); background: var(--pf-accent-soft); }
.ir-tag.region { color: var(--pf-info, #3a6a8a); background: var(--pf-info-soft, #e6eef4); }
</style>
