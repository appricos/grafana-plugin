import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, ConfirmModal, Field, FieldSet, IconButton, Input, Modal, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { attachChannel, createChannel, deleteChannel, extractErrorMessage, updateChannel } from './api';
import { Channel, SELECTABLE_TOPICS, Topic } from './types';

type Props = {
  pluginId: string;
  channels: Channel[];
  onChanged: () => void;
  onError: (message: string) => void;
};

type AddMode = 'create' | 'attach';

const ACKNOWLEDGMENT_DESCRIPTION = 'Only takes effect if your Pushinator account supports it; otherwise ignored.';

function TopicsCheckboxes({ value, onChange }: { value: Topic[]; onChange: (topics: Topic[]) => void }) {
  return (
    <div className={css({ display: 'flex', gap: '16px' })}>
      {SELECTABLE_TOPICS.map((topic) => (
        <Checkbox
          key={topic}
          label={topic}
          value={value.includes(topic)}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            onChange(checked ? [...value, topic] : value.filter((t) => t !== topic));
          }}
        />
      ))}
    </div>
  );
}

export function ChannelsSection({ pluginId, channels, onChanged, onError }: Props) {
  const s = useStyles2(getStyles);

  const [addMode, setAddMode] = useState<AddMode>('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pushinatorChannelId, setPushinatorChannelId] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [acknowledgmentEnabled, setAcknowledgmentEnabled] = useState(false);
  const [adding, setAdding] = useState(false);

  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [editTopics, setEditTopics] = useState<Topic[]>([]);
  const [editAck, setEditAck] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetAddForm = () => {
    setName('');
    setDescription('');
    setPushinatorChannelId('');
    setTopics([]);
    setAcknowledgmentEnabled(false);
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      if (addMode === 'create') {
        await createChannel(pluginId, { name, description, topics, acknowledgmentEnabled });
      } else {
        await attachChannel(pluginId, { pushinatorChannelId, topics, acknowledgmentEnabled });
      }
      resetAddForm();
      onChanged();
    } catch (e) {
      onError(extractErrorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const openEdit = (channel: Channel) => {
    setEditingChannel(channel);
    setEditTopics(channel.topics);
    setEditAck(channel.acknowledgmentEnabled);
  };

  const handleSaveEdit = async () => {
    if (!editingChannel) {
      return;
    }
    setSavingEdit(true);
    try {
      await updateChannel(pluginId, editingChannel.id, {
        name: editingChannel.name,
        description: editingChannel.description,
        topics: editTopics,
        acknowledgmentEnabled: editAck,
      });
      setEditingChannel(null);
      onChanged();
    } catch (e) {
      onError(extractErrorMessage(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingChannel) {
      return;
    }
    setDeleting(true);
    try {
      await deleteChannel(pluginId, deletingChannel.id);
      setDeletingChannel(null);
      onChanged();
    } catch (e) {
      onError(extractErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const canAdd = addMode === 'create' ? name.trim().length > 0 : pushinatorChannelId.trim().length > 0;

  return (
    <FieldSet label="Channels">
      {channels.length === 0 && <p className={s.colorWeak}>No channels yet.</p>}

      {channels.map((channel) => (
        <div key={channel.id} className={s.channelRow}>
          <div>
            <strong>{channel.name}</strong>
            {channel.description && <div className={s.colorWeak}>{channel.description}</div>}
            <div className={s.colorWeak}>
              Topics: {channel.topics.length > 0 ? channel.topics.join(', ') : 'none'}
              {channel.acknowledgmentEnabled ? ' · Acknowledgment required' : ''}
            </div>
          </div>
          <div>
            <IconButton name="file-edit-alt" aria-label={`Edit ${channel.name}`} onClick={() => openEdit(channel)} />
            <IconButton name="trash-alt" aria-label={`Delete ${channel.name}`} onClick={() => setDeletingChannel(channel)} />
          </div>
        </div>
      ))}

      <div className={s.addForm}>
        <RadioButtonGroup<AddMode>
          options={[
            { label: 'Create new channel', value: 'create' },
            { label: 'Attach existing channel', value: 'attach' },
          ]}
          value={addMode}
          onChange={setAddMode}
        />

        {addMode === 'create' ? (
          <>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Ops alerts" />
            </Field>
            <Field label="Description" description="Optional">
              <Input value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
            </Field>
          </>
        ) : (
          <Field label="Pushinator channel ID" description="ID of a channel you already created in Pushinator">
            <Input
              value={pushinatorChannelId}
              onChange={(e) => setPushinatorChannelId(e.currentTarget.value)}
              placeholder="e.g. 3f9a1b2c-..."
            />
          </Field>
        )}

        <Field label="Topics">
          <TopicsCheckboxes value={topics} onChange={setTopics} />
        </Field>

        <Checkbox
          label="Require acknowledgment"
          value={acknowledgmentEnabled}
          onChange={(e) => setAcknowledgmentEnabled(e.currentTarget.checked)}
          description={ACKNOWLEDGMENT_DESCRIPTION}
        />

        <div className={s.addButton}>
          <Button onClick={handleAdd} disabled={!canAdd || adding}>
            {addMode === 'create' ? 'Create channel' : 'Attach channel'}
          </Button>
        </div>
      </div>

      {editingChannel && (
        <Modal title={`Edit ${editingChannel.name}`} isOpen onDismiss={() => setEditingChannel(null)}>
          <Field label="Topics">
            <TopicsCheckboxes value={editTopics} onChange={setEditTopics} />
          </Field>
          <Checkbox
            label="Require acknowledgment"
            value={editAck}
            onChange={(e) => setEditAck(e.currentTarget.checked)}
            description={ACKNOWLEDGMENT_DESCRIPTION}
          />
          <Modal.ButtonRow>
            <Button variant="secondary" onClick={() => setEditingChannel(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              Save
            </Button>
          </Modal.ButtonRow>
        </Modal>
      )}

      <ConfirmModal
        isOpen={!!deletingChannel}
        title="Delete channel"
        body={`Are you sure you want to delete "${deletingChannel?.name}"? This cannot be undone. If this channel is also used by another integration (e.g. Shopify or Stripe), it will only be removed from Grafana - it will keep working there.`}
        confirmText="Delete"
        confirmButtonVariant="destructive"
        disabled={deleting}
        onConfirm={handleDelete}
        onDismiss={() => setDeletingChannel(null)}
      />
    </FieldSet>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  colorWeak: css`
    color: ${theme.colors.text.secondary};
  `,
  channelRow: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: ${theme.spacing(1)} 0;
    border-bottom: 1px solid ${theme.colors.border.weak};
  `,
  addForm: css`
    margin-top: ${theme.spacing(3)};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    max-width: 480px;
  `,
  addButton: css`
    margin-top: ${theme.spacing(1)};
  `,
});
