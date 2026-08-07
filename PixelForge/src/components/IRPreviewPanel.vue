<script setup lang="ts">
import { ref } from 'vue';
import type { IRTreeNode } from '../types';

defineProps<{
  treeData: IRTreeNode[];
}>();

const emit = defineEmits<{
  toggleVisibility: [id: string];
}>();

// Track expanded state per node id
const expandedMap = ref<Record<string, boolean>>({});

function isExpanded(node: IRTreeNode): boolean {
  return expandedMap.value[node.id] !== false; // default expanded
}

function toggleExpand(node: IRTreeNode) {
  if (node.children && node.children.length > 0) {
    expandedMap.value[node.id] = !isExpanded(node);
  }
}
</script>

<template>
  <div class="pf-panel glass-surface" style="height: 100%">
    <div class="pf-panel-header">
      <span class="pf-panel-title">场景图</span>
    </div>
    <div class="pf-panel-body">
      <div class="pf-tree">
        <template v-for="node in treeData" :key="node.id">
          <!-- Recursive template via inline render -->
          <div class="pf-tree-node">
            <div class="pf-tree-row">
              <div
                class="pf-tree-toggle"
                :class="{ expanded: isExpanded(node) }"
                :style="{ visibility: node.children && node.children.length > 0 ? 'visible' : 'hidden' }"
                @click="toggleExpand(node)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
              <div class="pf-tree-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <span class="pf-tree-label">{{ node.name }}</span>
              <span v-if="node.type" class="pf-tree-badge">{{ node.type }}</span>
              <button class="pf-tree-action" @click="emit('toggleVisibility', node.id)">
                <PhEye v-if="node.visible !== false" :size="14" weight="regular" />
                <PhEyeSlash v-else :size="14" weight="regular" />
              </button>
            </div>

            <!-- Children -->
            <div v-if="node.children && node.children.length > 0 && isExpanded(node)" class="pf-tree-children">
              <template v-for="child1 in node.children" :key="child1.id">
                <div class="pf-tree-node">
                  <div class="pf-tree-row">
                    <div
                      class="pf-tree-toggle"
                      :class="{ expanded: isExpanded(child1) }"
                      :style="{ visibility: child1.children && child1.children.length > 0 ? 'visible' : 'hidden' }"
                      @click="toggleExpand(child1)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                    <div class="pf-tree-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                    </div>
                    <span class="pf-tree-label">{{ child1.name }}</span>
                    <span v-if="child1.type" class="pf-tree-badge">{{ child1.type }}</span>
                    <button class="pf-tree-action" @click="emit('toggleVisibility', child1.id)">
                      <PhEye v-if="child1.visible !== false" :size="14" weight="regular" />
                      <PhEyeSlash v-else :size="14" weight="regular" />
                    </button>
                  </div>

                  <!-- Level 3 -->
                  <div v-if="child1.children && child1.children.length > 0 && isExpanded(child1)" class="pf-tree-children">
                    <template v-for="child2 in child1.children" :key="child2.id">
                      <div class="pf-tree-node">
                        <div class="pf-tree-row">
                          <div
                            class="pf-tree-toggle"
                            :class="{ expanded: isExpanded(child2) }"
                            :style="{ visibility: child2.children && child2.children.length > 0 ? 'visible' : 'hidden' }"
                            @click="toggleExpand(child2)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                          <div class="pf-tree-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                              <circle cx="12" cy="12" r="4" />
                            </svg>
                          </div>
                          <span class="pf-tree-label">{{ child2.name }}</span>
                          <span v-if="child2.type" class="pf-tree-badge">{{ child2.type }}</span>
                          <button class="pf-tree-action" @click="emit('toggleVisibility', child2.id)">
                            <PhEye v-if="child2.visible !== false" :size="14" weight="regular" />
                            <PhEyeSlash v-else :size="14" weight="regular" />
                          </button>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
