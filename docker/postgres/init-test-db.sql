-- Local integration tests use isolated schemas inside this separate database.
-- Runs once, when Docker initializes a new postgres_data volume.
CREATE DATABASE codemeet_test;
