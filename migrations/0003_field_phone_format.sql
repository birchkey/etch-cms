ALTER TABLE fields ADD COLUMN phone_format TEXT CHECK(phone_format IN ('us', 'international'));
