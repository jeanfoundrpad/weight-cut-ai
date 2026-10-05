-- Weight Cut AI — two low/high findings from the same independent code
-- review, bundled since both are small.

-- 1. group_messages.body had no length constraint at all -- an easy spam
-- and storage lever inside a group chat. 2000 chars is generous for a
-- real message (this isn't a content feed, see 0002's module comment),
-- just a ceiling against abuse.
alter table group_messages add constraint group_messages_body_length check (char_length(body) <= 2000);
