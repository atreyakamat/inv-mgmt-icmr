-- Function privileges, re-asserted independently of which database role ran
-- the earlier migrations (default privileges are per-role, so functions created
-- from the SQL Editor otherwise inherit EXECUTE for PUBLIC).

revoke execute on all functions in schema inventory from public, anon;

grant execute on function
  inventory.current_member(), inventory.is_member(), inventory.has_permission(text),
  inventory.my_permissions(), inventory.role_is_hidden(bigint),
  inventory.me(), inventory.update_my_name(text),
  inventory.set_member_role(uuid, bigint), inventory.set_member_active(uuid, boolean),
  inventory.create_role(text, text, text, text[]), inventory.update_role(bigint, text, text, text[]),
  inventory.delete_role(bigint),
  inventory.submit_request(bigint, text, jsonb, date), inventory.cancel_request(bigint, text),
  inventory.review_request(bigint, boolean, text), inventory.approve_request(bigint, jsonb, text),
  inventory.reject_request(bigint, text), inventory.fulfill_request(bigint, text),
  inventory.receive_stock(bigint, bigint, int, text), inventory.adjust_stock(bigint, bigint, int, text),
  inventory.transfer_stock(bigint, bigint, bigint, int, text)
to authenticated;

alter default privileges in schema inventory revoke execute on functions from public;
