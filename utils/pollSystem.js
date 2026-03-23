const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const POLL_PANEL_CHANNEL_ID = '1485686826558816296';
const POLL_PANEL_BUTTON_ID = 'poll_panel_create';
const POLL_CREATE_STEP_ONE_MODAL_ID = 'poll_create_step_one';
const POLL_CONTINUE_BUTTON_PREFIX = 'poll_continue_setup:';
const POLL_FINISH_BUTTON_PREFIX = 'poll_finish_setup:';
const POLL_BUTTON_PREFIX = 'anketa_vote:';
const POLL_LOGO_EMOJI = '<:srlogo:1439652081693888544>';
const POLL_LOGO_EMOJI_MAX = 10;
const PLAYER_ROLE_ID = '1238209853009297560';
const ADMIN_ROLE_IDS = new Set([
  '1238860450528235550',
  '1449551727010254858',
  '863814372610146314',
]);

const activePolls = new Map();
const pendingPollDrafts = new Map();
const POLL_OPTION_STEP_CONFIGS = [
  { step: 2, modalId: 'poll_create_step_two', optionNumbers: [2, 3] },
  { step: 3, modalId: 'poll_create_step_three', optionNumbers: [4, 5] },
  { step: 4, modalId: 'poll_create_step_four', optionNumbers: [6, 7] },
  { step: 5, modalId: 'poll_create_step_five', optionNumbers: [8, 9] },
  { step: 6, modalId: 'poll_create_step_six', optionNumbers: [10] },
];

function isUnknownInteractionError(error) {
  return error?.code === 10062;
}

function memberHasRole(member, roleId) {
  return Boolean(member?.roles?.cache?.has(roleId));
}

function canUseAdvancedPollSetup(member) {
  for (const roleId of ADMIN_ROLE_IDS) {
    if (memberHasRole(member, roleId)) {
      return true;
    }
  }

  return false;
}

function canUsePollPanel(member) {
  if (canUseAdvancedPollSetup(member)) {
    return true;
  }

  return memberHasRole(member, PLAYER_ROLE_ID);
}

function buildPollPanelContent() {
  return [
    '**ANKETE**',
    '',
    'Ovdje možeš kreirati ankete za mape, modove i ostale važne odluke na serveru.',
    '',
    '• Svaki član može glasati samo jednom',
    '• Promjena glasa je moguća dok anketa traje',
    '• Rezultati se ažuriraju uživo nakon svakog glasa',
    '• Po isteku vremena glasanje se automatski zatvara',
    '',
    'Klikni na **Kreiraj anketu** za početak.',
  ].join('\n');
}

function buildPollPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(POLL_PANEL_BUTTON_ID)
      .setLabel('Kreiraj anketu')
      .setStyle(ButtonStyle.Success)
  );
}

function buildPollAnnouncementContent(poll) {
  return `<@&${PLAYER_ROLE_ID}>\n${buildPollMessageContent(poll)}`;
}

function buildPollStepOneModal() {
  return new ModalBuilder()
    .setCustomId(POLL_CREATE_STEP_ONE_MODAL_ID)
    .setTitle('Kreiranje ankete - 1/2')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_title')
          .setLabel('Naslov ankete')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('npr. Koju mapu vozimo ovaj vikend?')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_description')
          .setLabel('Opis ankete')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder('Kratko objasni sta se bira i zasto glasate.')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_duration')
          .setLabel('Trajanje ankete')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20)
          .setPlaceholder('npr. 30m, 6h, 2d')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_1_title')
          .setLabel('Naslov opcije 1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('npr. Balkanska Dolina')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_1_description')
          .setLabel('Opis opcije 1')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder('npr. Mala polja, brda i roleplay gameplay.')
      )
    );
}

function getPollOptionStepConfig(stepNumber) {
  return POLL_OPTION_STEP_CONFIGS.find((config) => config.step === stepNumber) || null;
}

function getPollOptionStepConfigByModalId(modalId) {
  return POLL_OPTION_STEP_CONFIGS.find((config) => config.modalId === modalId) || null;
}

function buildPollOptionStepModal(stepNumber) {
  const config = getPollOptionStepConfig(stepNumber);
  if (!config) {
    return null;
  }

  const components = [];

  for (const optionNumber of config.optionNumbers) {
    components.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`poll_option_${optionNumber}_title`)
          .setLabel(`Naslov opcije ${optionNumber} (opcionalno)`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder(`npr. Opcija ${optionNumber}`)
      )
    );

    components.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`poll_option_${optionNumber}_description`)
          .setLabel(`Opis opcije ${optionNumber} (opcionalno)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(200)
          .setPlaceholder(`Upisi opis za opciju ${optionNumber}.`)
      )
    );
  }

  return new ModalBuilder()
    .setCustomId(config.modalId)
    .setTitle(`Kreiranje ankete - ${stepNumber}/6`)
    .addComponents(...components);
}

function buildContinueSetupRow(userId, nextStep) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${POLL_CONTINUE_BUTTON_PREFIX}${userId}:${nextStep}`)
      .setLabel(`Otvori korak ${nextStep}`)
      .setStyle(ButtonStyle.Primary)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${POLL_FINISH_BUTTON_PREFIX}${userId}`)
      .setLabel('Zavrsi anketu')
      .setStyle(ButtonStyle.Success)
  );

  return row;
}

function formatDiscordRelativeTime(timestampMs) {
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

function buildButtonStyle(index) {
  const styles = [
    ButtonStyle.Success,
    ButtonStyle.Primary,
    ButtonStyle.Secondary,
    ButtonStyle.Danger,
  ];

  return styles[index] || ButtonStyle.Secondary;
}

function parsePollDuration(rawValue) {
  const value = rawValue.trim().toLowerCase();
  const match = value.match(/^(\d+)\s*([mhd])$/);

  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }[unit];

  const durationMs = amount * unitMs;
  const minDurationMs = 5 * 60 * 1000;
  const maxDurationMs = 14 * 24 * 60 * 60 * 1000;

  if (durationMs < minDurationMs || durationMs > maxDurationMs) {
    return null;
  }

  return durationMs;
}

function formatDurationLabel(durationMs) {
  if (durationMs % (24 * 60 * 60 * 1000) === 0) {
    return `${durationMs / (24 * 60 * 60 * 1000)}d`;
  }

  if (durationMs % (60 * 60 * 1000) === 0) {
    return `${durationMs / (60 * 60 * 1000)}h`;
  }

  return `${durationMs / (60 * 1000)}m`;
}

function normalizeOption(option, index) {
  return {
    id: `option_${index + 1}`,
    label: option.label,
    description: option.description,
    style: buildButtonStyle(index),
  };
}

function hasDuplicateOptionTitles(options) {
  const labels = options.map((option) => option.label.trim().toLowerCase());
  return new Set(labels).size !== labels.length;
}

function getVoteTotals(poll) {
  const totals = Object.fromEntries(poll.options.map((option) => [option.id, 0]));

  for (const selectedOptionId of poll.votes.values()) {
    if (typeof totals[selectedOptionId] === 'number') {
      totals[selectedOptionId] += 1;
    }
  }

  return totals;
}

function getVotePercent(totalVotes, votesForOption) {
  if (!totalVotes) {
    return 0;
  }

  return Math.round((votesForOption / totalVotes) * 100);
}

function buildVoteBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function buildVoteEmojiLine(votes) {
  if (!votes) {
    return 'Nema glasova jos.';
  }

  const emojiCount = Math.min(votes, POLL_LOGO_EMOJI_MAX);
  const emojiLine = Array.from({ length: emojiCount }, () => POLL_LOGO_EMOJI).join(' ');

  if (votes > POLL_LOGO_EMOJI_MAX) {
    return `${emojiLine} x${votes}`;
  }

  return emojiLine;
}

function getLeadingOption(poll, totals) {
  return poll.options.reduce((best, option) => {
    const votes = totals[option.id];

    if (!best || votes > best.votes) {
      return { label: option.label, votes };
    }

    return best;
  }, null);
}

function buildPollButtons(poll, { disabled = false } = {}) {
  const row = new ActionRowBuilder();

  for (const option of poll.options) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${POLL_BUTTON_PREFIX}${option.id}`)
        .setLabel(option.label)
        .setStyle(option.style)
        .setDisabled(disabled)
    );
  }

  return row;
}

function buildPollMessageContent(poll) {
  const totals = getVoteTotals(poll);
  const totalVotes = poll.votes.size;
  const isClosed = poll.closed || Date.now() >= poll.endsAt;
  const leader = getLeadingOption(poll, totals);

  return [
    '**GLASANJE**',
    '',
    `**${poll.title}**`,
    '',
    poll.description,
    '',
    isClosed
      ? 'Glasanje je zavrseno. Finalni rezultati su zakljucani ispod.'
      : `Glasanje zavrsava ${formatDiscordRelativeTime(poll.endsAt)}.`,
    '',
    ...poll.options.flatMap((option) => [
      `📌 **${option.label}**`,
      option.description,
      '',
      `**Glasova:** ${totals[option.id]}`,
      `**Prikaz glasova:** ${buildVoteEmojiLine(totals[option.id])}`,
      '',
    ]),
    '**Pregled**',
    `Ukupno glasova: **${totalVotes}**`,
    `Trajanje: **${formatDurationLabel(poll.durationMs)}**`,
    leader ? `Vodi: **${leader.label}** (${leader.votes} glasova)` : 'Vodi: jos nema glasova',
    '',
    '**Rezultati**',
    ...poll.options.map((option) => `• **${option.label}**: ${totals[option.id]} glasova`),
    '',
    '_Jedan korisnik moze imati samo jedan aktivan glas_',
  ].join('\n');
}

function buildStepOneDraft(interaction) {
  const durationMs = parsePollDuration(
    interaction.fields.getTextInputValue('poll_duration')
  );

  if (!durationMs) {
    return { error: 'Trajanje mora biti izmedu 5m i 14d. Primjeri: 30m, 6h, 2d.' };
  }

  return {
    title: interaction.fields.getTextInputValue('poll_title').trim(),
    description: interaction.fields.getTextInputValue('poll_description').trim(),
    durationMs,
    options: [
      {
        label: interaction.fields.getTextInputValue('poll_option_1_title').trim(),
        description: interaction.fields
          .getTextInputValue('poll_option_1_description')
          .trim(),
      },
    ],
  };
}

function appendOptionsFromModalStep(draft, interaction, optionNumbers) {
  const nextOptions = [...draft.options];

  for (const optionNumber of optionNumbers) {
    const title = interaction.fields
      .getTextInputValue(`poll_option_${optionNumber}_title`)
      .trim();
    const description = interaction.fields
      .getTextInputValue(`poll_option_${optionNumber}_description`)
      .trim();

    if (title || description) {
      if (!title || !description) {
        return {
          error: `Ako koristis opciju ${optionNumber}, moras upisati i naslov i opis.`,
        };
      }

      nextOptions.push({
        label: title,
        description,
      });
    }
  }

  return {
    ...draft,
    options: nextOptions,
  };
}

function buildPollFromDraft(draft) {
  if (hasDuplicateOptionTitles(draft.options)) {
    return {
      error: 'Nazivi opcija moraju biti razliciti. Promijeni duplikate i pokusaj ponovno.',
    };
  }

  const endsAt = Date.now() + draft.durationMs;

  return {
    title: draft.title,
    description: draft.description,
    durationMs: draft.durationMs,
    options: draft.options.map(normalizeOption),
    votes: new Map(),
    endsAt,
    closed: false,
    timeout: null,
  };
}

async function finalizePoll(client, messageId) {
  const poll = activePolls.get(messageId);
  if (!poll || poll.closed) {
    return;
  }

  poll.closed = true;

  if (poll.timeout) {
    clearTimeout(poll.timeout);
    poll.timeout = null;
  }

  try {
    const channel = await client.channels.fetch(poll.channelId);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const message = await channel.messages.fetch(messageId);
    await message.edit({
      content: buildPollMessageContent(poll),
      components: [buildPollButtons(poll, { disabled: true })],
    });
  } catch (error) {
    console.error('ANKETA FINALIZE ERROR:', error);
  }
}

function schedulePollEnd(client, poll) {
  const remainingMs = Math.max(poll.endsAt - Date.now(), 0);
  poll.timeout = setTimeout(() => {
    finalizePoll(client, poll.messageId).catch((error) => {
      console.error('ANKETA TIMER ERROR:', error);
    });
  }, remainingMs);
}

async function postPollPanel(interaction, client) {
  const channel = await client.channels.fetch(POLL_PANEL_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Poll panel channel ${POLL_PANEL_CHANNEL_ID} nije dostupan.`);
  }

  await channel.send({
    content: buildPollPanelContent(),
    components: [buildPollPanelRow()],
  });
}

async function safeShowPollModal(interaction, modalBuilder) {
  try {
    await interaction.showModal(modalBuilder);
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.error('ANKETA MODAL ERROR: interaction expired before modal could open.');

      const channel = interaction.channel;
      if (channel?.isTextBased()) {
        await channel.send({
          content: `<@${interaction.user.id}> klik je istekao prije otvaranja forme. Klikni ponovo na **Kreiraj anketu**.`,
        }).catch(() => {});
      }

      return true;
    }

    throw error;
  }
}

async function safeReply(interaction, payload, logLabel) {
  try {
    await interaction.reply(payload);
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.error(`${logLabel}: interaction expired before reply.`);
      return false;
    }

    throw error;
  }
}

async function safeFollowUp(interaction, payload, logLabel) {
  try {
    await interaction.followUp(payload);
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.error(`${logLabel}: interaction expired before follow-up.`);
      return false;
    }

    throw error;
  }
}

async function safeUpdate(interaction, payload, logLabel) {
  try {
    await interaction.update(payload);
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.error(`${logLabel}: interaction expired before update.`);
      return false;
    }

    throw error;
  }
}

async function handlePollButton(interaction, client) {
  if (interaction.customId === POLL_PANEL_BUTTON_ID) {
    if (!canUsePollPanel(interaction.member)) {
      await safeReply(
        interaction,
        {
          content: 'Nemáš permisiju za kreiranje anketa.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA PERMISSION ERROR'
      );
      return true;
    }

    await safeShowPollModal(interaction, buildPollStepOneModal());
    return true;
  }

  if (interaction.customId.startsWith(POLL_FINISH_BUTTON_PREFIX)) {
    const ownerId = interaction.customId.slice(POLL_FINISH_BUTTON_PREFIX.length);

    if (interaction.user.id !== ownerId) {
      await safeReply(
        interaction,
        {
          content: 'Samo korisnik koji je zapoceo unos moze zavrsiti ovu anketu.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA FINISH OWNER ERROR'
      );
      return true;
    }

    const draft = pendingPollDrafts.get(interaction.user.id);
    if (!draft) {
      await safeReply(
        interaction,
        {
          content: 'Nema spremljenog unosa za zavrsetak ankete. Pokreni kreiranje ponovo.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA FINISH DRAFT ERROR'
      );
      return true;
    }

    const poll = buildPollFromDraft(draft);
    if (poll.error) {
      await safeReply(
        interaction,
        {
          content: poll.error,
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA FINISH BUILD ERROR'
      );
      return true;
    }

    const pollMessage = await interaction.channel.send({
      content: buildPollAnnouncementContent(poll),
      components: [buildPollButtons(poll)],
    });

    poll.messageId = pollMessage.id;
    poll.channelId = interaction.channelId;
    poll.guildId = interaction.guildId;
    poll.createdBy = interaction.user.id;

    activePolls.set(pollMessage.id, poll);
    pendingPollDrafts.delete(interaction.user.id);
    schedulePollEnd(client, poll);

    await safeReply(
      interaction,
      {
        content: `Anketa **${poll.title}** je uspjesno kreirana i traje ${formatDurationLabel(poll.durationMs)}.`,
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA FINISH REPLY ERROR'
    );
    return true;
  }

  if (interaction.customId.startsWith(POLL_CONTINUE_BUTTON_PREFIX)) {
    const rawPayload = interaction.customId.slice(POLL_CONTINUE_BUTTON_PREFIX.length);
    const [ownerId, nextStepRaw] = rawPayload.split(':');
    const nextStep = Number.parseInt(nextStepRaw || '0', 10);

    if (interaction.user.id !== ownerId) {
      await safeReply(
        interaction,
        {
          content: 'Samo korisnik koji je zapoceo unos moze nastaviti ovu anketu.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA CONTINUE ERROR'
      );
      return true;
    }

    const draft = pendingPollDrafts.get(interaction.user.id);
    if (!draft) {
      await safeReply(
        interaction,
        {
          content: 'Prvi korak je istekao. Klikni ponovo na **Kreiraj anketu**.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA DRAFT ERROR'
      );
      return true;
    }

    const modal = buildPollOptionStepModal(nextStep);
    if (!modal) {
      await safeReply(
        interaction,
        {
          content: 'Sljedeci korak za ovu anketu nije pronaden.',
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA NEXT STEP ERROR'
      );
      return true;
    }

    await safeShowPollModal(interaction, modal);
    return true;
  }

  if (!interaction.customId.startsWith(POLL_BUTTON_PREFIX)) {
    return false;
  }

  const poll = activePolls.get(interaction.message.id);
  if (!poll) {
    await safeReply(
      interaction,
      {
        content: 'Ova anketa vise nije aktivna ili je restart bota ocistio stanje iz memorije.',
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA STATE ERROR'
    );
    return true;
  }

  if (poll.closed || Date.now() >= poll.endsAt) {
    await finalizePoll(client, poll.messageId);
    await safeReply(
      interaction,
      {
        content: 'Anketa je zavrsena. Dugmad su iskljucena, a finalni rezultati su ostali prikazani.',
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA CLOSED ERROR'
    );
    return true;
  }

  const selectedOptionId = interaction.customId.slice(POLL_BUTTON_PREFIX.length);
  const selectedOption = poll.options.find((option) => option.id === selectedOptionId);

  if (!selectedOption) {
    await safeReply(
      interaction,
      {
        content: 'Odabrana opcija nije prepoznata.',
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA OPTION ERROR'
    );
    return true;
  }

  const previousVote = poll.votes.get(interaction.user.id);
  poll.votes.set(interaction.user.id, selectedOption.id);

  const updated = await safeUpdate(
    interaction,
    {
      content: buildPollMessageContent(poll),
      components: [buildPollButtons(poll)],
    },
    'ANKETA VOTE UPDATE ERROR'
  );

  if (!updated) {
    return true;
  }

  await safeFollowUp(
    interaction,
    {
      content:
        previousVote && previousVote !== selectedOption.id
          ? `Tvoj glas je prebacen na **${selectedOption.label}**.`
          : previousVote === selectedOption.id
            ? `Tvoj glas za **${selectedOption.label}** je vec zabiljezen.`
            : `Tvoj glas za **${selectedOption.label}** je uspjesno zabiljezen.`,
      flags: MessageFlags.Ephemeral,
    },
    'ANKETA VOTE FOLLOWUP ERROR'
  );

  return true;
}

async function handlePollModal(interaction, client) {
  if (!interaction.isModalSubmit()) {
    return false;
  }

  if (interaction.customId === POLL_CREATE_STEP_ONE_MODAL_ID) {
    const draft = buildStepOneDraft(interaction);

    if (draft.error) {
      await safeReply(
        interaction,
        {
          content: draft.error,
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA STEP1 ERROR'
      );
      return true;
    }

    pendingPollDrafts.set(interaction.user.id, {
      ...draft,
      channelId: interaction.channelId,
      createdAt: Date.now(),
      nextStep: 2,
    });

    if (!canUseAdvancedPollSetup(interaction.member)) {
      const simplePoll = {
        title: draft.title,
        description: draft.description,
        durationMs: draft.durationMs,
        options: draft.options.map(normalizeOption),
        votes: new Map(),
        endsAt: Date.now() + draft.durationMs,
        closed: false,
        timeout: null,
      };

      const pollMessage = await interaction.channel.send({
        content: buildPollAnnouncementContent(simplePoll),
        components: [buildPollButtons(simplePoll)],
      });

      simplePoll.messageId = pollMessage.id;
      simplePoll.channelId = interaction.channelId;
      simplePoll.guildId = interaction.guildId;
      simplePoll.createdBy = interaction.user.id;

      activePolls.set(pollMessage.id, simplePoll);
      pendingPollDrafts.delete(interaction.user.id);
      schedulePollEnd(client, simplePoll);

      await safeReply(
        interaction,
        {
          content: `Anketa **${simplePoll.title}** je uspjesno kreirana i traje ${formatDurationLabel(simplePoll.durationMs)}.`,
          flags: MessageFlags.Ephemeral,
        },
        'ANKETA STEP1 SIMPLE REPLY ERROR'
      );
      return true;
    }

    await safeReply(
      interaction,
      {
        content:
          'Korak 1 je spremljen. Klikni ispod za nastavak unosa ostalih opcija.',
        components: [buildContinueSetupRow(interaction.user.id, 2)],
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA STEP1 REPLY ERROR'
    );
    return true;
  }

  const optionStepConfig = getPollOptionStepConfigByModalId(interaction.customId);
  if (!optionStepConfig) {
    return false;
  }

  const draft = pendingPollDrafts.get(interaction.user.id);
  if (!draft) {
    await safeReply(
      interaction,
      {
        content: 'Prvi korak nije pronaden ili je istekao. Pokreni kreiranje ankete ponovo.',
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA STEP2 DRAFT ERROR'
    );
    return true;
  }

  const updatedDraft = appendOptionsFromModalStep(
    draft,
    interaction,
    optionStepConfig.optionNumbers
  );
  if (updatedDraft.error) {
    await safeReply(
      interaction,
      {
        content: updatedDraft.error,
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA STEP2 BUILD ERROR'
    );
    return true;
  }

  if (optionStepConfig.step < 6) {
    const nextStep = optionStepConfig.step + 1;
    pendingPollDrafts.set(interaction.user.id, {
      ...updatedDraft,
      nextStep,
    });

    await safeReply(
      interaction,
      {
        content: `Korak ${optionStepConfig.step} je spremljen. Klikni ispod za nastavak unosa.`,
        components: [buildContinueSetupRow(interaction.user.id, nextStep)],
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA NEXT STEP REPLY ERROR'
    );
    return true;
  }

  const poll = buildPollFromDraft(updatedDraft);
  if (poll.error) {
    await safeReply(
      interaction,
      {
        content: poll.error,
        flags: MessageFlags.Ephemeral,
      },
      'ANKETA FINAL BUILD ERROR'
    );
    return true;
  }

  const pollMessage = await interaction.channel.send({
    content: buildPollAnnouncementContent(poll),
    components: [buildPollButtons(poll)],
  });

  poll.messageId = pollMessage.id;
  poll.channelId = interaction.channelId;
  poll.guildId = interaction.guildId;
  poll.createdBy = interaction.user.id;

  activePolls.set(pollMessage.id, poll);
  pendingPollDrafts.delete(interaction.user.id);
  schedulePollEnd(client, poll);

  await safeReply(
    interaction,
    {
      content: `Anketa **${poll.title}** je uspjesno kreirana i traje ${formatDurationLabel(poll.durationMs)}.`,
      flags: MessageFlags.Ephemeral,
    },
    'ANKETA STEP2 REPLY ERROR'
  );

  return true;
}

module.exports = {
  handlePollButton,
  handlePollModal,
  postPollPanel,
};
