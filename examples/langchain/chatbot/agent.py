"""
Minimal chatbot built with LangChain deployed on Superserve.
"""

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")

while True:
    try:
        user_input = input()
    except EOFError:
        break
    response = llm.invoke([HumanMessage(content=user_input)])
    print(response.content)
