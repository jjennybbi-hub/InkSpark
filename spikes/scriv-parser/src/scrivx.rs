//! `.scrivx` binder parsing with quick-xml. The conventions are in `fixtures/README.md` under
//! "Binder". The walk is event-driven with an explicit context stack, so it never recurses.

use std::collections::BTreeMap;

use quick_xml::XmlVersion;
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::reader::Reader;

use crate::{Binder, BinderItem, BinderItemKind, ScrivError};

/// Binder nesting limit. Real projects stay far below it; the cap keeps the derived (recursive)
/// `Drop`, `Clone`, `PartialEq` and `Serialize` impls of `BinderItem` within the stack.
pub(crate) const MAX_BINDER_DEPTH: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MetaField {
    IncludeInCompile,
    LabelId,
    StatusId,
}

/// What an open element means. Text is captured only inside `Title`, `Meta`, `Label` and
/// `Status`; every other element is `Other` and is ignored with all its content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ctx {
    Root,
    Binder,
    Item,
    Children,
    Title,
    MetaData,
    Meta(MetaField),
    LabelSettings,
    Labels,
    Label(Option<i32>),
    StatusSettings,
    StatusItems,
    Status(Option<i32>),
    Other,
}

impl Ctx {
    fn captures_text(self) -> bool {
        matches!(
            self,
            Ctx::Title | Ctx::Meta(_) | Ctx::Label(_) | Ctx::Status(_)
        )
    }
}

fn xml_err(e: impl std::fmt::Display) -> ScrivError {
    ScrivError::Xml(e.to_string())
}

fn attribute(start: &BytesStart<'_>, name: &str) -> Result<Option<String>, ScrivError> {
    match start.try_get_attribute(name).map_err(xml_err)? {
        Some(attr) => Ok(Some(
            attr.normalized_value(XmlVersion::Implicit1_0)
                .map_err(xml_err)?
                .into_owned(),
        )),
        None => Ok(None),
    }
}

fn parse_id(text: &str) -> Option<i32> {
    text.trim().parse().ok()
}

fn kind_of(type_attr: Option<String>) -> BinderItemKind {
    match type_attr.as_deref() {
        Some("DraftFolder") => BinderItemKind::DraftFolder,
        Some("ResearchFolder") => BinderItemKind::ResearchFolder,
        Some("TrashFolder") => BinderItemKind::TrashFolder,
        Some("Folder") => BinderItemKind::Folder,
        Some("Text") => BinderItemKind::Text,
        _ => BinderItemKind::Other(type_attr.unwrap_or_default()),
    }
}

fn resolve_reference(reference: &BytesRef<'_>) -> Result<String, ScrivError> {
    if let Some(c) = reference.resolve_char_ref().map_err(xml_err)? {
        return Ok(c.to_string());
    }
    quick_xml::escape::resolve_predefined_entity(reference)
        .map(str::to_owned)
        .ok_or_else(|| ScrivError::Xml(format!("unknown entity &{};", &**reference)))
}

struct Walker {
    ctx: Vec<Ctx>,
    /// Items still open, innermost last.
    items: Vec<BinderItem>,
    binder: Binder,
    text: String,
    root_seen: bool,
    root_closed: bool,
}

impl Walker {
    fn parent(&self) -> Option<Ctx> {
        self.ctx.last().copied()
    }

    fn open(&mut self, start: &BytesStart<'_>) -> Result<(), ScrivError> {
        let name = start.name();
        let name = name.as_ref();
        let ctx = match self.parent() {
            None => {
                if self.root_seen {
                    return Err(ScrivError::Xml("more than one root element".to_owned()));
                }
                if name != "ScrivenerProject" {
                    return Err(ScrivError::Xml(format!(
                        "root element is <{name}>, expected <ScrivenerProject>"
                    )));
                }
                self.root_seen = true;
                self.binder.format_version = attribute(start, "Version")?.unwrap_or_default();
                Ctx::Root
            }
            Some(Ctx::Root) => match name {
                "Binder" => Ctx::Binder,
                "LabelSettings" => Ctx::LabelSettings,
                "StatusSettings" => Ctx::StatusSettings,
                _ => Ctx::Other,
            },
            Some(Ctx::Binder | Ctx::Children) if name == "BinderItem" => {
                if self.items.len() >= MAX_BINDER_DEPTH {
                    return Err(ScrivError::Xml(format!(
                        "binder nested deeper than {MAX_BINDER_DEPTH} levels"
                    )));
                }
                self.items.push(BinderItem {
                    uuid: attribute(start, "UUID")?.unwrap_or_default(),
                    kind: kind_of(attribute(start, "Type")?),
                    title: String::new(),
                    include_in_compile: false,
                    label_id: None,
                    status_id: None,
                    children: Vec::new(),
                });
                Ctx::Item
            }
            Some(Ctx::Item) => match name {
                "Title" => Ctx::Title,
                "MetaData" => Ctx::MetaData,
                "Children" => Ctx::Children,
                _ => Ctx::Other,
            },
            Some(Ctx::MetaData) => match name {
                "IncludeInCompile" => Ctx::Meta(MetaField::IncludeInCompile),
                "LabelID" => Ctx::Meta(MetaField::LabelId),
                "StatusID" => Ctx::Meta(MetaField::StatusId),
                _ => Ctx::Other,
            },
            Some(Ctx::LabelSettings) if name == "Labels" => Ctx::Labels,
            Some(Ctx::Labels) if name == "Label" => {
                Ctx::Label(attribute(start, "ID")?.as_deref().and_then(parse_id))
            }
            Some(Ctx::StatusSettings) if name == "StatusItems" => Ctx::StatusItems,
            Some(Ctx::StatusItems) if name == "Status" => {
                Ctx::Status(attribute(start, "ID")?.as_deref().and_then(parse_id))
            }
            Some(_) => Ctx::Other,
        };
        if ctx.captures_text() {
            self.text.clear();
        }
        self.ctx.push(ctx);
        Ok(())
    }

    fn close(&mut self) -> Result<(), ScrivError> {
        let ctx = self
            .ctx
            .pop()
            .ok_or_else(|| ScrivError::Xml("unexpected end tag".to_owned()))?;
        let text = if ctx.captures_text() {
            std::mem::take(&mut self.text)
        } else {
            String::new()
        };
        match ctx {
            Ctx::Root => self.root_closed = true,
            Ctx::Item => {
                if let Some(item) = self.items.pop() {
                    match self.items.last_mut() {
                        Some(parent) => parent.children.push(item),
                        None => self.binder.items.push(item),
                    }
                }
            }
            Ctx::Title => {
                if let Some(item) = self.items.last_mut() {
                    item.title = text.trim().to_owned();
                }
            }
            Ctx::Meta(field) => {
                if let Some(item) = self.items.last_mut() {
                    match field {
                        MetaField::IncludeInCompile => {
                            item.include_in_compile = text.trim() == "Yes";
                        }
                        MetaField::LabelId => item.label_id = parse_id(&text).filter(|&n| n != -1),
                        MetaField::StatusId => {
                            item.status_id = parse_id(&text).filter(|&n| n != -1);
                        }
                    }
                }
            }
            Ctx::Label(Some(id)) => {
                self.binder.labels.insert(id, text.trim().to_owned());
            }
            Ctx::Status(Some(id)) => {
                self.binder.statuses.insert(id, text.trim().to_owned());
            }
            _ => {}
        }
        Ok(())
    }

    fn capture(&mut self, s: &str) {
        if self.parent().is_some_and(Ctx::captures_text) {
            self.text.push_str(s);
        }
    }
}

pub(crate) fn parse_scrivx(xml: &str) -> Result<Binder, ScrivError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = true;
    let mut w = Walker {
        ctx: Vec::new(),
        items: Vec::new(),
        binder: Binder {
            format_version: String::new(),
            items: Vec::new(),
            labels: BTreeMap::new(),
            statuses: BTreeMap::new(),
        },
        text: String::new(),
        root_seen: false,
        root_closed: false,
    };

    while !w.root_closed {
        match reader.read_event().map_err(xml_err)? {
            Event::Start(start) => w.open(&start)?,
            Event::Empty(start) => {
                w.open(&start)?;
                w.close()?;
            }
            Event::End(_) => w.close()?,
            Event::Text(text) => {
                let content = text.xml10_content();
                if w.ctx.is_empty() && !content.trim().is_empty() {
                    return Err(ScrivError::Xml("text outside the root element".to_owned()));
                }
                w.capture(&content);
            }
            Event::CData(cdata) => {
                if w.ctx.is_empty() {
                    return Err(ScrivError::Xml("CDATA outside the root element".to_owned()));
                }
                w.capture(&cdata.xml10_content());
            }
            Event::GeneralRef(reference) => {
                if w.ctx.is_empty() {
                    return Err(ScrivError::Xml(
                        "reference outside the root element".to_owned(),
                    ));
                }
                let resolved = resolve_reference(&reference)?;
                w.capture(&resolved);
            }
            Event::Eof => {
                return Err(ScrivError::Xml(if w.root_seen {
                    "unexpected end of input: elements still open".to_owned()
                } else {
                    "no <ScrivenerProject> root element".to_owned()
                }));
            }
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
        }
    }
    Ok(w.binder)
}
