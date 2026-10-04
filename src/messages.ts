// The messages people send to invite friends (pure functions, no app code).

const APP = 'Cosmic Balance';

/** The message for a friend's personal invite. */
export function inviteMessage(opts: { friend: string; groups: string[]; link: string }): string {
  const first = opts.friend.includes('@') ? '' : ` ${opts.friend.split(/\s+/)[0]}`;
  const where =
    opts.groups.length === 0
      ? `as a friend on ${APP}`
      : opts.groups.length === 1
        ? `to “${opts.groups[0]}” on ${APP}`
        : `to ${opts.groups
            .slice(0, -1)
            .map((g) => `“${g}”`)
            .join(', ')} and “${opts.groups[opts.groups.length - 1]}” on ${APP}`;
  return `Hi${first}! I’ve added you ${where}, so we can split our expenses. Tap to join (sign in with Google): ${opts.link}`;
}

/** The message with your friend link. */
export function friendRequestMessage(opts: { name: string; link: string }): string {
  return `Hi! It’s ${opts.name.split(/\s+/)[0]}. Let’s be friends on ${APP} so we can split our expenses. Tap to connect (sign in with Google): ${opts.link}`;
}

/** The message for a group's link (anyone can ask to join; the group's creator lets them in). */
export function groupLinkMessage(opts: { group: string; link: string }): string {
  return `Join “${opts.group}” on ${APP} so we can split our expenses. Tap to ask to join (sign in with Google): ${opts.link}`;
}
